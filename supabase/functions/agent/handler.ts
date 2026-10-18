// Edge Function `agent` (P08). POST /functions/v1/agent/<operação>.
//
// agent.ask: vínculo + franquia no banco (agent_run_start) ANTES de qualquer ferramenta → motor determinístico
// (_shared/domain/agent) lendo só pelas RPCs agent_* com o JWT do usuário → rascunho de proposta gravado como
// pendente (agent_proposal_create). Nenhum LLM no piloto: sem provedor configurado, o texto vem de modelos fixos.
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
  type ErrorCode,
  IDEMPOTENCY_HEADER,
  IdempotencyKey,
  TENANT_HEADER,
} from "../_shared/contracts/index.ts";
import { runAgent } from "../_shared/domain/agent/engine.ts";
import type { Window } from "../_shared/domain/agent/time.ts";
import { type Agenda, type AgentData, type Directory, type Finance, ToolError } from "../_shared/domain/agent/types.ts";
import { canonicalJson, sha256Hex } from "../_shared/http/command.ts";
import { mapDbError } from "../_shared/http/errors.ts";
import { type Clock, corsHeaders, fail, isUuid, ok, requestIdFrom, systemClock } from "../_shared/http/respond.ts";
import { createRpcHandler, type Route, route, type RpcHandlerDeps } from "../_shared/http/rpc-handler.ts";

export type AgentDeps = RpcHandlerDeps;

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

  return async (req: Request): Promise<Response> => {
    const name = /\/agent\/([a-z_.]+)\/?$/.exec(new URL(req.url).pathname)?.[1] ?? "";
    if (name !== "agent.ask") return actions(req);
    const started = clock.now().getTime();
    const requestId = requestIdFrom(req);
    const cors = corsHeaders(req, deps.allowedOrigins);
    const meta: Record<string, unknown> = {};
    const res = await ask(req, requestId, cors, meta);
    deps.log?.({ fn: "agent", route: name, request_id: requestId, status: res.status, ms: clock.now().getTime() - started, ...meta });
    return res;
  };

  async function ask(req: Request, requestId: string, cors: Record<string, string>, meta: Record<string, unknown>) {
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
    const input = AgentAskInput.safeParse(json);
    if (!input.success) {
      const path = input.error.issues[0]?.path.map(String).join(".");
      return fail("VALIDATION_ERROR", requestId, { field: path || undefined, extra: cors });
    }

    const call = async (fn: string, args: Record<string, unknown>): Promise<unknown> => {
      const r = await deps.rpc(token, fn, { p_tenant_id: tenantId, ...args });
      if (r.error) {
        const m = mapDbError(r.error);
        throw new RpcFailure(m.code, m.field);
      }
      return r.data;
    };
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
      const result = await runAgent(input.data.text, {
        tenant: { id: tenantId, name: start.tenant_name, timezone: start.timezone }, role: start.role, now: clock.now(),
      }, data);
      meta.intent = result.intent;
      meta.tool_calls = result.tool_calls.length;

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
      if (e instanceof RpcFailure) {
        const message = e.code === "QUOTA_EXCEEDED"
          ? "Você atingiu o limite mensal de perguntas ao assistente. A franquia renova no início do próximo mês; a agenda e as outras telas continuam funcionando."
          : undefined;
        return fail(e.code, requestId, { field: e.field, message, extra: cors });
      }
      // Banco/rede fora do ar: erro explícito e reexecutável, nunca resposta inventada (AE-20).
      return fail("PROVIDER_UNAVAILABLE", requestId, { extra: cors });
    }
  }
}
