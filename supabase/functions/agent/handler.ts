// Edge Function `agent` (P08). POST /functions/v1/agent/<operação>.
//
// agent.ask: vínculo + franquia no banco (agent_run_start) ANTES de qualquer ferramenta → motor determinístico
// (_shared/domain/agent) lendo só pelas RPCs agent_* com o JWT do usuário → rascunho de proposta gravado como
// pendente (agent_proposal_create). O texto da resposta vem sempre dos modelos fixos com os números das ferramentas.
// P46: com provedor de linguagem ligado (`deps.llm`), um pedido que o motor não entende passa pelo modelo, que só
// escolhe intenção e argumentos (understand.ts); sem provedor (`LLM_PROVIDER=none`), tudo igual ao P08.
// agent.draft (P46): reescreve um rascunho do dono no tom pedido; volta como sugestão, nada é salvo nem enviado.
// action.approve / action.execute: uma RPC transacional cada (rpc-handler), com Idempotency-Key.
// Log técnico sem PII: nunca o texto da pergunta, da resposta, o token ou o tenant.
import {
  ActionApproval,
  ActionApproveInput,
  ActionExecuteInput,
  ActionProposal,
  ActionReceipt,
  AgentAnswer,
  AgentAskInput,
  AgentDraftInput,
  AgentDraftOutput,
  type ErrorCode,
  IDEMPOTENCY_HEADER,
  IdempotencyKey,
  TENANT_HEADER,
} from "../_shared/contracts/index.ts";
import type { Window } from "../_shared/domain/agent/time.ts";
import { type Agenda, type AgentData, type Directory, type Finance, ToolError } from "../_shared/domain/agent/types.ts";
import { canonicalJson, sha256Hex } from "../_shared/http/command.ts";
import { mapDbError } from "../_shared/http/errors.ts";
import { type Clock, corsHeaders, fail, isUuid, ok, requestIdFrom, systemClock } from "../_shared/http/respond.ts";
import { createRpcHandler, type Route, route, type RpcHandlerDeps } from "../_shared/http/rpc-handler.ts";
import { type Llm, noneLlm } from "../_shared/llm/index.ts";
import { labelNames, restoreLabels } from "../_shared/llm/redact.ts";
import { rewriteDraft } from "../_shared/llm/tasks/draft.ts";
import { understand } from "./understand.ts";

export interface AgentDeps extends RpcHandlerDeps {
  /** Camada de linguagem (P46). Ausente = `none`: o assistente é o motor determinístico do P08. */
  llm?: Llm;
}

export const AGENT_ACTION_ROUTES: Record<string, Route> = {
  "action.approve": route({
    rpc: "action_approve", input: ActionApproveInput, output: ActionApproval, command: true,
    args: (i) => ({ p_proposal_id: i.proposal_id, p_payload_hash: i.payload_hash, p_expected_version: i.expected_version }),
  }),
  "action.execute": route({
    rpc: "action_execute", input: ActionExecuteInput, output: ActionReceipt, command: true,
    args: (i) => ({ p_approval_id: i.approval_id }),
  }),
};

const MAX_BODY_BYTES = 16 * 1024;

/** Falha de RPC já traduzida para o catálogo de erros. */
class RpcFailure extends Error {
  constructor(readonly code: ErrorCode, readonly field?: string) {
    super(code);
  }
}

interface RunStart {
  run_id: string;
  role: "owner" | "staff";
  tenant_name: string;
  timezone: string;
}

export function createAgentHandler(deps: AgentDeps) {
  const clock: Clock = deps.clock ?? systemClock;
  const actions = createRpcHandler("agent", AGENT_ACTION_ROUTES, deps);
  const llm = deps.llm ?? noneLlm;

  return async (req: Request): Promise<Response> => {
    const name = /\/agent\/([a-z_.]+)\/?$/.exec(new URL(req.url).pathname)?.[1] ?? "";
    if (name !== "agent.ask" && name !== "agent.draft") return actions(req);
    const started = clock.now().getTime();
    const requestId = requestIdFrom(req);
    const cors = corsHeaders(req, deps.allowedOrigins);
    const meta: Record<string, unknown> = {};
    const res = name === "agent.ask" ? await ask(req, requestId, cors, meta) : await draft(req, requestId, cors, meta);
    deps.log?.({ fn: "agent", route: name, request_id: requestId, status: res.status, ms: clock.now().getTime() - started, ...meta });
    return res;
  };

  /** Preâmbulo comum: método, token, negócio selecionado, chave, tamanho e JSON. Response = falha já pronta. */
  async function preamble(req: Request, requestId: string, cors: Record<string, string>) {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (req.method !== "POST") return fail("VALIDATION_ERROR", requestId, { message: "Use POST.", extra: cors });
    const auth = req.headers.get("Authorization") ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    if (!token) return fail("AUTH_REQUIRED", requestId, { extra: cors });
    const tenantId = req.headers.get(TENANT_HEADER);
    if (!isUuid(tenantId)) {
      return fail("VALIDATION_ERROR", requestId, { field: "tenant_id", message: "Selecione um negócio.", extra: cors });
    }
    // Consulta: a chave é opcional. Com ela, repetir a mesma pergunta não debita a franquia de novo.
    const sentKey = IdempotencyKey.safeParse(req.headers.get(IDEMPOTENCY_HEADER));
    const key = sentKey.success ? sentKey.data : `ask-${crypto.randomUUID()}`;

    const text = await req.text().catch(() => "");
    if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
      return fail("VALIDATION_ERROR", requestId, { message: "Corpo grande demais.", extra: cors });
    }
    let json: unknown;
    try {
      json = text.trim() === "" ? {} : JSON.parse(text);
    } catch {
      return fail("VALIDATION_ERROR", requestId, { message: "JSON inválido.", extra: cors });
    }
    return { token, tenantId, key, json };
  }

  /** Chamada de RPC com o JWT do usuário e o negócio do header; erro traduzido para o catálogo. */
  function rpcCaller(token: string, tenantId: string) {
    return async (fn: string, args: Record<string, unknown>): Promise<unknown> => {
      const r = await deps.rpc(token, fn, { p_tenant_id: tenantId, ...args });
      if (r.error) {
        const m = mapDbError(r.error);
        throw new RpcFailure(m.code, m.field);
      }
      return r.data;
    };
  }

  function rpcFailure(e: RpcFailure, requestId: string, cors: Record<string, string>) {
    const message = e.code === "QUOTA_EXCEEDED"
      ? "Você atingiu o limite mensal de perguntas ao assistente. A franquia renova no início do próximo mês; a agenda e as outras telas continuam funcionando."
      : undefined;
    return fail(e.code, requestId, { field: e.field, message, extra: cors });
  }

  async function ask(req: Request, requestId: string, cors: Record<string, string>, meta: Record<string, unknown>) {
    const pre = await preamble(req, requestId, cors);
    if (pre instanceof Response) return pre;
    const { token, tenantId, key, json } = pre;
    const input = AgentAskInput.safeParse(json);
    if (!input.success) {
      const path = input.error.issues[0]?.path.map(String).join(".");
      return fail("VALIDATION_ERROR", requestId, { field: path || undefined, extra: cors });
    }

    const call = rpcCaller(token, tenantId);
    /** Leitura de ferramenta: sem permissão vira resposta honesta ("só o dono vê"), não erro. */
    const tool = async <T>(fn: string, args: Record<string, unknown>): Promise<T> => {
      try {
        return (await call(fn, args)) as T;
      } catch (e) {
        if (e instanceof RpcFailure && e.code === "FORBIDDEN") throw new ToolError("FORBIDDEN");
        throw e;
      }
    };

    try {
      // 1 · vínculo e franquia, antes de qualquer leitura (AE-29, AE-30, AE-33).
      const start = (await call("agent_run_start", { p_idem_key: key })) as RunStart;
      const data: AgentData = {
        directory: () => tool<Directory>("agent_directory", {}),
        agenda: (w: Window) => tool<Agenda>("agent_agenda_read", { p_from: w.starts_at, p_to: w.ends_at }),
        finance: (w: Window) => tool<Finance>("agent_finance_read", { p_from: w.starts_at, p_to: w.ends_at }),
      };
      // 2 · motor: o texto do usuário e os dados do negócio são dados; ui_context não muda tenant nem papel.
      //     Pedido que o motor não entende passa pelo modelo (se ligado), que só escolhe intenção e argumentos.
      const { result, llm: llmUse } = await understand(input.data.text, {
        tenant: { id: tenantId, name: start.tenant_name, timezone: start.timezone }, role: start.role, now: clock.now(),
      }, data, llm);
      meta.intent = result.intent;
      meta.tool_calls = result.tool_calls.length;
      meta.llm = llmUse;

      // 3 · rascunho → proposta pendente (hash, versão e prazo definidos pelo banco).
      let proposal: unknown = null;
      if (result.draft) {
        const env = (await call("agent_proposal_create", {
          p_run_id: start.run_id, p_tool: result.draft.tool, p_payload: result.draft.payload, p_summary: result.draft.summary,
          p_idem_key: await sha256Hex(`${key}:proposal`),
          p_request_hash: await sha256Hex(canonicalJson({ operation: "agent.propose", draft: result.draft })),
          p_request_id: requestId,
        })) as { status_code?: number; body?: unknown };
        const parsed = ActionProposal.safeParse(env?.body);
        if (!parsed.success) return fail("INTERNAL_ERROR", requestId, { extra: cors });
        proposal = parsed.data;
      }
      const answer = AgentAnswer.safeParse({ state: result.state, text: result.text, sources: result.sources, proposal });
      if (!answer.success) return fail("INTERNAL_ERROR", requestId, { extra: cors });
      return ok(answer.data, requestId, clock, 200, cors);
    } catch (e) {
      if (e instanceof RpcFailure) return rpcFailure(e, requestId, cors);
      // Banco/rede fora do ar: erro explícito e reexecutável, nunca resposta inventada (AE-20).
      return fail("PROVIDER_UNAVAILABLE", requestId, { extra: cors });
    }
  }

  async function draft(req: Request, requestId: string, cors: Record<string, string>, meta: Record<string, unknown>) {
    const pre = await preamble(req, requestId, cors);
    if (pre instanceof Response) return pre;
    const { token, tenantId, key, json } = pre;
    const input = AgentDraftInput.safeParse(json);
    if (!input.success) {
      const path = input.error.issues[0]?.path.map(String).join(".");
      return fail("VALIDATION_ERROR", requestId, { field: path || undefined, extra: cors });
    }
    // Sem provedor: nada a fazer e nada a debitar. O dono segue com o próprio rascunho.
    if (!llm.enabled) return ok(AgentDraftOutput.parse({ available: false, suggestion: null }), requestId, clock, 200, cors);
    const call = rpcCaller(token, tenantId);
    try {
      // Mesmo portão e franquia do agent.ask: vínculo e débito antes de qualquer leitura ou chamada ao modelo.
      const start = (await call("agent_run_start", { p_idem_key: key })) as RunStart;
      if (start.role !== "owner") return fail("FORBIDDEN", requestId, { message: "Só o dono do negócio redige textos pelo assistente.", extra: cors });
      // Nomes de clientes do negócio viram "cliente N" para o modelo e voltam no texto final, só aqui.
      const dir = (await call("agent_directory", {})) as Directory;
      const labeled = labelNames(input.data.text, dir.customers.map((c) => c.name));
      const out = await rewriteDraft(llm, input.data.kind, input.data.tone, labeled.text);
      meta.kind = input.data.kind;
      meta.suggested = out !== null;
      const suggestion = out === null ? null : restoreLabels(out, labeled.labels).slice(0, 600);
      return ok(AgentDraftOutput.parse({ available: true, suggestion }), requestId, clock, 200, cors);
    } catch (e) {
      if (e instanceof RpcFailure) return rpcFailure(e, requestId, cors);
      return fail("PROVIDER_UNAVAILABLE", requestId, { extra: cors });
    }
  }
}
