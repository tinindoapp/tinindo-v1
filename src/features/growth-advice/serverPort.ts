// Portas reais de Metas e sugestões: Edge Function `growth-advice` (P22, P45).
import { AdviceDecideOutput, AdviceListOutput, ContentListOutput, ContentPublishOutput, DigestListOutput, GoalListOutput, GoalOutput, InsightCommandOutput, InsightListOutput } from "@contracts";
import { AssistEventOutput } from "../../../supabase/functions/_shared/domain/agent/events.ts";
import { INSIGHT_EXPLAIN } from "../../../supabase/functions/_shared/domain/agent/insight-explain.ts";
import type { createApiClient } from "../../lib/api/client.ts";
import type { GrowthAdvicePort } from "./port.ts";

type Call = ReturnType<typeof createApiClient>;
const op = (name: string) => `/growth-advice/${name}`;

export function createServerPort(call: Call, tenantId: string): GrowthAdvicePort {
  const post = (body: unknown, idempotencyKey?: string) => ({ method: "POST" as const, tenantId, body, idempotencyKey });
  return {
    kind: "server",
    async goals() {
      return (await call(op("goal.list"), GoalListOutput, post({}))).data;
    },
    async saveGoal(input, key) {
      return (await call(op("goal.save"), GoalOutput, post(input, key))).data.goal;
    },
    async archiveGoal(goal, key) {
      return (await call(op("goal.archive"), GoalOutput, post({ goal_id: goal.id, expected_version: goal.version }, key))).data.goal;
    },
    async advice() {
      return (await call(op("advice.list"), AdviceListOutput, post({}))).data;
    },
    async decide(rule_code, decision, key) {
      await call(op("advice.decide"), AdviceDecideOutput, post({ rule_code, decision }, key));
    },
    async content() {
      return (await call(op("content.list"), ContentListOutput, post({}))).data;
    },
    async publish(template_code, key) {
      await call(op("content.publish"), ContentPublishOutput, post({ template_code }, key));
    },
    async unpublish(expected_version, key) {
      await call(op("content.unpublish"), ContentPublishOutput, post({ expected_version }, key));
    },
    async insights(scope) {
      return (await call(op("insight.list"), InsightListOutput, post({ scope }))).data;
    },
    async snoozeInsight(insight, key) {
      return (await call(op("insight.snooze"), InsightCommandOutput, post({ insight_id: insight.id, expected_version: insight.version }, key))).data;
    },
    async actInsight(insight, key) {
      return (await call(op("insight.act"), InsightCommandOutput, post({ insight_id: insight.id, expected_version: insight.version }, key))).data;
    },
    async digests() {
      return (await call(op("digest.list"), DigestListOutput, post({}))).data;
    },
  };
}

/**
 * "Por quê?" (`insight.explain`): rota própria da função, fora do registro v1 (como o `setup.describe` nasceu). Fica
 * fora de createServerPort para a porta continuar batendo, método a método, com o registro de contratos.
 */
export function createServerExplain(call: Call, tenantId: string): NonNullable<GrowthAdvicePort["explain"]> {
  return async (insight_id) => {
    const data = (await call(op(INSIGHT_EXPLAIN.name), INSIGHT_EXPLAIN.output, { method: "POST", tenantId, body: { insight_id } })).data;
    // T15: medição sem conteúdo (a explicação foi mostrada). Sem esperar nem falhar: medir nunca atrapalha a tela.
    void call("/agent/assist.event", AssistEventOutput, { method: "POST", tenantId, body: { event: "shown", surface: "explain" } }).catch(() => undefined);
    return data;
  };
}

/** Porta completa de Metas e sugestões (com o "Por quê?"). */
export function createServerGrowthPort(call: Call, tenantId: string): GrowthAdvicePort {
  return { ...createServerPort(call, tenantId), explain: createServerExplain(call, tenantId) };
}
