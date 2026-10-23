// Portas reais de Metas e conteúdo: Edge Function `growth-advice`.
import { AdviceDecideOutput, AdviceListOutput, ContentListOutput, ContentPublishOutput, GoalListOutput, GoalOutput } from "@contracts";
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
  };
}
