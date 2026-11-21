// Edge Function `growth-advice` (P22, P45): metas por indicador, sugestões por regras, conteúdo aprovado e insights. Dono pelo
// rpc-handler; o acompanhamento das sugestões é do worker `jobs`; a publicação passa pelo escopo do perfil (P09).
//
// `insight.explain` ("Por quê?", T3 da revisão de 04/11) é a única rota que não é "uma RPC", por isso fica fora de
// GROWTH_ADVICE_ROUTES (como o `setup.describe` do P50). Só roda quando o dono abre a sugestão, nunca na Home:
// 1) `insight_explanation_get` confere dono, módulo e negócio e traz a evidência, a versão e a frase já guardada;
// 2) frase guardada para a versão → devolve (`assistant`), sem modelo nem débito; 3) senão, com provedor ligado, o
// portão `agent_run_start` (vínculo, dono e franquia mensal, como o `agent.draft`), a tarefa EXPLAIN do P46 só com o
// título da regra e os números da evidência, e a gravação por `insight_explanation_save` (só a versão atual, nunca
// sobrescreve). Sem provedor, franquia esgotada, modelo fora ou frase com número fora da evidência: frase FIXA por
// regra (`fixed`), nunca erro. Nada é executado aqui.
import {
  AdviceDecideInput, AdviceDecideOutput, AdviceListInput, AdviceListOutput, ContentListInput, ContentListOutput, ContentPublishInput, ContentPublishOutput,
  ContentUnpublishInput, DigestListInput, DigestListOutput, GoalArchiveInput, GoalListInput, GoalListOutput, GoalOutput, GoalSaveInput,
  InsightCommandInput, InsightCommandOutput, InsightEvidence, InsightListInput, InsightListOutput, InsightRuleCode, InsightState, TENANT_HEADER, Uuid,
} from "../_shared/contracts/index.ts";
import { z } from "zod";
import { acceptableTone, explainFacts, fixedExplanation } from "../_shared/domain/agent/explain-fixed.ts";
import { INSIGHT_EXPLAIN, InsightExplainInput, InsightExplainOutput } from "../_shared/domain/agent/insight-explain.ts";
import { mapDbError } from "../_shared/http/errors.ts";
import { corsHeaders, fail, isUuid, ok, requestIdFrom, systemClock } from "../_shared/http/respond.ts";
import { createRpcHandler, type Route, route, type RpcHandlerDeps } from "../_shared/http/rpc-handler.ts";
import { type Llm, noneLlm } from "../_shared/llm/index.ts";
import { explainInsight } from "../_shared/llm/tasks/explain.ts";

export interface GrowthAdviceDeps extends RpcHandlerDeps {
  /** Camada de linguagem (P46). Ausente ou `none`: o "Por quê?" é sempre a frase fixa por regra. */
  llm?: Llm;
}

export const GROWTH_ADVICE_ROUTES: Record<string, Route> = {
  "goal.save": route({
    rpc: "goal_save", input: GoalSaveInput, output: GoalOutput, command: true,
    args: (i) => ({ p_goal_id: i.goal_id, p_expected_version: i.expected_version, p_metric_key: i.metric_key, p_target: i.target, p_period_start: i.period_start, p_note: i.note }),
  }),
  "goal.archive": route({ rpc: "goal_archive", input: GoalArchiveInput, output: GoalOutput, command: true, args: (i) => ({ p_goal_id: i.goal_id, p_expected_version: i.expected_version }) }),
  "goal.list": route({ rpc: "goal_list", input: GoalListInput, output: GoalListOutput, command: false, args: () => ({}) }),
  "advice.list": route({ rpc: "advice_list", input: AdviceListInput, output: AdviceListOutput, command: false, args: () => ({}) }),
  "advice.decide": route({ rpc: "advice_decide", input: AdviceDecideInput, output: AdviceDecideOutput, command: true, args: (i) => ({ p_rule_code: i.rule_code, p_decision: i.decision }) }),
  "content.list": route({ rpc: "content_list", input: ContentListInput, output: ContentListOutput, command: false, args: () => ({}) }),
  "content.publish": route({ rpc: "content_publish", input: ContentPublishInput, output: ContentPublishOutput, command: true, args: (i) => ({ p_template_code: i.template_code }) }),
  "content.unpublish": route({ rpc: "content_unpublish", input: ContentUnpublishInput, output: ContentPublishOutput, command: true, args: (i) => ({ p_expected_version: i.expected_version }) }),
  // P45 · insights proativos (o motor roda no worker `jobs`; aqui só leitura, "Agora não" e "Preparar").
  "insight.list": route({ rpc: "insight_list", input: InsightListInput, output: InsightListOutput, command: false, args: (i) => ({ p_scope: i.scope }) }),
  "insight.snooze": route({ rpc: "insight_snooze", input: InsightCommandInput, output: InsightCommandOutput, command: true, args: (i) => ({ p_insight_id: i.insight_id, p_expected_version: i.expected_version }) }),
  "insight.act": route({ rpc: "insight_act", input: InsightCommandInput, output: InsightCommandOutput, command: true, args: (i) => ({ p_insight_id: i.insight_id, p_expected_version: i.expected_version }) }),
  "digest.list": route({ rpc: "digest_list", input: DigestListInput, output: DigestListOutput, command: false, args: () => ({}) }),
};

/** Rota e schemas de `insight.explain`. Fora de GROWTH_ADVICE_ROUTES e do registro v1 (ver o cabeçalho). */
export { INSIGHT_EXPLAIN };

/** O que `insight_explanation_get` devolve: a evidência como o motor gravou, a versão atual e a frase dessa versão. */
const ExplainRow = z.object({
  insight_id: Uuid,
  rule_code: InsightRuleCode,
  rule_title: z.string().min(1),
  state: InsightState,
  version: z.int().min(1),
  evidence: InsightEvidence,
  text: z.string().min(1).nullable(),
});
const SavedRow = z.object({ saved: z.boolean(), text: z.string().min(1) });

const MAX_BODY_BYTES = 16 * 1024;

export function createGrowthAdviceHandler(deps: GrowthAdviceDeps) {
  const rpcHandler = createRpcHandler("growth-advice", GROWTH_ADVICE_ROUTES, deps);
  const llm = deps.llm ?? noneLlm;
  const clock = deps.clock ?? systemClock;

  async function explain(req: Request, requestId: string, cors: Record<string, string>, meta: Record<string, unknown>): Promise<Response> {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (req.method !== "POST") return fail("VALIDATION_ERROR", requestId, { message: "Use POST.", extra: cors });
    const auth = req.headers.get("Authorization") ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    if (!token) return fail("AUTH_REQUIRED", requestId, { extra: cors });
    const tenantId = req.headers.get(TENANT_HEADER);
    if (!isUuid(tenantId)) return fail("VALIDATION_ERROR", requestId, { field: "tenant_id", message: "Selecione um negócio.", extra: cors });
    const body = await req.text().catch(() => "");
    if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) return fail("VALIDATION_ERROR", requestId, { message: "Corpo grande demais.", extra: cors });
    let json: unknown;
    try {
      json = body.trim() === "" ? {} : JSON.parse(body);
    } catch {
      return fail("VALIDATION_ERROR", requestId, { message: "JSON inválido.", extra: cors });
    }
    const input = InsightExplainInput.safeParse(json);
    if (!input.success) return fail("VALIDATION_ERROR", requestId, { field: input.error.issues[0]?.path.map(String).join(".") || "insight_id", extra: cors });

    // 1 · dono, módulo e negócio conferidos no banco antes de qualquer coisa (o header do negócio é seleção, não autorização).
    let row: z.infer<typeof ExplainRow>;
    try {
      const got = await deps.rpc(token, "insight_explanation_get", { p_tenant_id: tenantId, p_insight_id: input.data.insight_id });
      if (got.error) {
        const mapped = mapDbError(got.error);
        return fail(mapped.code, requestId, { field: mapped.field, extra: cors });
      }
      const parsed = ExplainRow.safeParse(got.data);
      if (!parsed.success) return fail("INTERNAL_ERROR", requestId, { extra: cors });
      row = parsed.data;
    } catch {
      return fail("PROVIDER_UNAVAILABLE", requestId, { extra: cors });
    }
    const reply = (text: string, source: "assistant" | "fixed") => {
      meta.source = source;
      const out = InsightExplainOutput.safeParse({ insight_id: row.insight_id, version: row.version, text, source });
      return out.success ? ok(out.data, requestId, clock, 200, cors) : fail("INTERNAL_ERROR", requestId, { extra: cors });
    };

    // 2 · já explicada nesta versão: sem modelo e sem débito.
    if (row.text) {
      meta.cached = true;
      return reply(row.text, "assistant");
    }
    const fixed = fixedExplanation(row.rule_code, row.evidence);
    if (!llm.enabled) return reply(fixed, "fixed");

    // 3 · portão e franquia do assistente; a chave é da versão: abrir de novo a mesma versão não debita outra vez.
    try {
      const start = await deps.rpc(token, "agent_run_start", { p_tenant_id: tenantId, p_idem_key: `explain-${row.insight_id}-v${row.version}` });
      const role = (start.data as { role?: unknown } | null)?.role;
      if (start.error || role !== "owner") {
        meta.assistant_skipped = start.error ? mapDbError(start.error).code : "FORBIDDEN";
        return reply(fixed, "fixed");
      }
      // Para o modelo: só o título da regra e os números da evidência (nada de cliente, id ou rota).
      const sentence = await explainInsight(llm, { title: row.rule_title, facts: explainFacts(row.rule_code, row.evidence) });
      if (sentence === null || !acceptableTone(sentence)) {
        meta.assistant_skipped = sentence === null ? "INVALID" : "TONE";
        return reply(fixed, "fixed");
      }
      // 4 · guarda para a versão; se outra aba gravou antes, vale a que já estava.
      const saved = await deps.rpc(token, "insight_explanation_save", {
        p_tenant_id: tenantId, p_insight_id: row.insight_id, p_version: row.version, p_text: sentence,
      });
      const kept = saved.error ? null : SavedRow.safeParse(saved.data);
      meta.saved = kept?.success ? kept.data.saved : false;
      return reply(kept?.success ? kept.data.text : sentence, "assistant");
    } catch {
      meta.assistant_skipped = "PROVIDER_UNAVAILABLE";
      return reply(fixed, "fixed");
    }
  }

  return async (req: Request): Promise<Response> => {
    if (!/\/growth-advice\/insight\.explain\/?$/.test(new URL(req.url).pathname)) return rpcHandler(req);
    const started = clock.now().getTime();
    const requestId = requestIdFrom(req);
    const meta: Record<string, unknown> = {};
    const res = await explain(req, requestId, corsHeaders(req, deps.allowedOrigins), meta);
    // Log técnico sem PII: sem negócio, token, evidência nem frase; só de onde veio a frase e por que o modelo ficou de fora.
    deps.log?.({ fn: "growth-advice", route: INSIGHT_EXPLAIN.name, request_id: requestId, status: res.status, ms: clock.now().getTime() - started, ...meta });
    return res;
  };
}
