// Edge Function `setup` (P44): configuração guiada. Cada operação é uma RPC transacional (ver _shared/http/rpc-handler.ts).
// O estado dos passos é calculado no banco pelos dados reais; criar serviços e aplicar o rascunho passam pelas RPCs do
// P02 e do P03, com a confirmação do dono já dada na tela. A leitura `setup.progress` grava a medição (primeira
// conclusão de cada passo + evento), por isso a RPC não é `stable`, mas a rota continua uma consulta (sem chave).
//
// `setup.describe` (P50, T2 da revisão de 04/11) é a única rota que não é "uma RPC": lê a frase do negócio no servidor.
// 1) `setup_templates` confere o vínculo com o negócio (a mesma leitura da tela); 2) as REGRAS leem a frase
// (_shared/domain/setup/describe.ts); 3) só se ficar campo sem ler, o modelo de linguagem do P46 é consultado, atrás
// do portão `agent_run_start` (vínculo, dono e franquia mensal) e da redação de PII da camada `_shared/llm`; 4) a saída
// diz, campo a campo, de onde veio (`sources`: rules | assistant). Com LLM_PROVIDER=none a rota devolve o rascunho das
// regras, sem portão e sem débito. Nada é gravado aqui: o dono revisa e confirma por `setup.draft_apply`.
import {
  SetupDismissInput,
  SetupDismissOutput,
  SetupDraftApplyInput,
  SetupDraftApplyOutput,
  SetupModuleSetInput,
  SetupModuleSetOutput,
  SetupProgressInput,
  SetupProgressOutput,
  SetupScopeInput,
  SetupScopeOutput,
  SetupServicesApplyInput,
  SetupServicesApplyOutput,
  SetupTemplatesInput,
  SetupTemplatesOutput,
} from "../_shared/contracts/index.ts";
import { IDEMPOTENCY_HEADER, IdempotencyKey, TENANT_HEADER } from "../_shared/contracts/index.ts";
import { describeBusiness, mergeAssistantDraft, SetupDescribeInput, SetupDescribeOutput } from "../_shared/domain/setup/describe.ts";
import { mapDbError } from "../_shared/http/errors.ts";
import { corsHeaders, fail, isUuid, ok, requestIdFrom, systemClock } from "../_shared/http/respond.ts";
import { createRpcHandler, type Route, route, type RpcHandlerDeps } from "../_shared/http/rpc-handler.ts";
import { type Llm, noneLlm } from "../_shared/llm/index.ts";
import { readBusinessPhrase } from "../_shared/llm/tasks/setup.ts";

export interface SetupDeps extends RpcHandlerDeps {
  /** Camada de linguagem (P46). Ausente ou `none`: a frase é lida só pelas regras. */
  llm?: Llm;
}

export const SETUP_ROUTES: Record<string, Route> = {
  "setup.progress": route({ rpc: "setup_progress", input: SetupProgressInput, output: SetupProgressOutput, command: false, args: () => ({}) }),
  "setup.dismiss": route({
    rpc: "setup_dismiss", input: SetupDismissInput, output: SetupDismissOutput, command: true,
    args: (i) => ({ p_step: i.step, p_dismissed: i.dismissed }),
  }),
  "setup.templates": route({ rpc: "setup_templates", input: SetupTemplatesInput, output: SetupTemplatesOutput, command: false, args: () => ({}) }),
  "setup.services_apply": route({
    rpc: "setup_services_apply", input: SetupServicesApplyInput, output: SetupServicesApplyOutput, command: true,
    args: (i) => ({ p_services: i.services }),
  }),
  "setup.draft_apply": route({
    rpc: "setup_draft_apply", input: SetupDraftApplyInput, output: SetupDraftApplyOutput, command: true,
    args: (i) => ({ p_profession: i.profession, p_hours: i.hours, p_services: i.services }),
  }),
  // P51: escopo do negócio (profissão, plano e módulos) e a chave dos módulos "por ativação".
  "setup.scope": route({ rpc: "setup_scope", input: SetupScopeInput, output: SetupScopeOutput, command: false, args: () => ({}) }),
  "setup.module_set": route({
    rpc: "setup_module_set", input: SetupModuleSetInput, output: SetupModuleSetOutput, command: true,
    args: (i) => ({ p_module: i.module, p_enabled: i.enabled }),
  }),
};

/** Rota e schemas de `setup.describe`. Fora de SETUP_ROUTES porque não é "uma RPC" (ver o cabeçalho). */
export const SETUP_DESCRIBE = { name: "setup.describe", input: SetupDescribeInput, output: SetupDescribeOutput } as const;

const MAX_BODY_BYTES = 64 * 1024;

export function createSetupHandler(deps: SetupDeps) {
  const rpcHandler = createRpcHandler("setup", SETUP_ROUTES, deps);
  const llm = deps.llm ?? noneLlm;
  const clock = deps.clock ?? systemClock;

  async function describe(req: Request, requestId: string, cors: Record<string, string>, meta: Record<string, unknown>): Promise<Response> {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (req.method !== "POST") return fail("VALIDATION_ERROR", requestId, { message: "Use POST.", extra: cors });
    const auth = req.headers.get("Authorization") ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    if (!token) return fail("AUTH_REQUIRED", requestId, { extra: cors });
    const tenantId = req.headers.get(TENANT_HEADER);
    if (!isUuid(tenantId)) return fail("VALIDATION_ERROR", requestId, { field: "tenant_id", message: "Selecione um negócio.", extra: cors });
    const text = await req.text().catch(() => "");
    if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) return fail("VALIDATION_ERROR", requestId, { message: "Corpo grande demais.", extra: cors });
    let json: unknown;
    try {
      json = text.trim() === "" ? {} : JSON.parse(text);
    } catch {
      return fail("VALIDATION_ERROR", requestId, { message: "JSON inválido.", extra: cors });
    }
    const input = SetupDescribeInput.safeParse(json);
    if (!input.success) return fail("VALIDATION_ERROR", requestId, { field: input.error.issues[0]?.path.map(String).join(".") || "sentence", extra: cors });

    // 1 · vínculo com o negócio, antes de ler a frase (o header do negócio é seleção, não autorização).
    try {
      const gate = await deps.rpc(token, "setup_templates", { p_tenant_id: tenantId });
      if (gate.error) {
        const mapped = mapDbError(gate.error);
        return fail(mapped.code, requestId, { field: mapped.field, extra: cors });
      }
    } catch {
      return fail("PROVIDER_UNAVAILABLE", requestId, { extra: cors });
    }

    // 2 · regras primeiro.
    let draft = describeBusiness(input.data.sentence);
    let assistant = false;
    meta.unknown = draft.unknown.length;

    // 3 · modelo só para o que ficou sem ler, com provedor ligado e chave de idempotência (a franquia é debitada uma
    //     vez por chave). Sem chave, dono ou franquia, ou com o provedor fora do ar, vale o rascunho das regras.
    const key = IdempotencyKey.safeParse(req.headers.get(IDEMPOTENCY_HEADER));
    if (draft.unknown.length > 0 && llm.enabled && key.success) {
      try {
        const start = await deps.rpc(token, "agent_run_start", { p_tenant_id: tenantId, p_idem_key: key.data });
        const role = (start.data as { role?: unknown } | null)?.role;
        if (!start.error && role === "owner") {
          const read = await readBusinessPhrase(llm, input.data.sentence);
          assistant = read !== null;
          draft = mergeAssistantDraft(draft, read, input.data.sentence);
        } else meta.assistant_skipped = start.error ? mapDbError(start.error).code : "FORBIDDEN";
      } catch {
        meta.assistant_skipped = "PROVIDER_UNAVAILABLE";
      }
    }
    meta.assistant = assistant;
    const out = SetupDescribeOutput.safeParse({ ...draft, assistant });
    if (!out.success) return fail("INTERNAL_ERROR", requestId, { extra: cors });
    return ok(out.data, requestId, clock, 200, cors);
  }

  return async (req: Request): Promise<Response> => {
    if (!/\/setup\/setup\.describe\/?$/.test(new URL(req.url).pathname)) return rpcHandler(req);
    const started = clock.now().getTime();
    const requestId = requestIdFrom(req);
    const meta: Record<string, unknown> = {};
    const res = await describe(req, requestId, corsHeaders(req, deps.allowedOrigins), meta);
    // Log técnico sem PII: sem negócio, token, frase nem rascunho; só quantos campos ficaram sem ler e se o modelo foi usado.
    deps.log?.({ fn: "setup", route: SETUP_DESCRIBE.name, request_id: requestId, status: res.status, ms: clock.now().getTime() - started, ...meta });
    return res;
  };
}
