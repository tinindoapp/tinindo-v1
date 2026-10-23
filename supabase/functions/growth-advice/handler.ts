// Edge Function `growth-advice` (P22): metas por indicador, sugestões por regras e conteúdo aprovado. Dono pelo
// rpc-handler; o acompanhamento das sugestões é do worker `jobs`; a publicação passa pelo escopo do perfil (P09).
import {
  AdviceDecideInput, AdviceDecideOutput, AdviceListInput, AdviceListOutput, ContentListInput, ContentListOutput, ContentPublishInput, ContentPublishOutput,
  ContentUnpublishInput, GoalArchiveInput, GoalListInput, GoalListOutput, GoalOutput, GoalSaveInput,
} from "../_shared/contracts/index.ts";
import { createRpcHandler, type Route, route, type RpcHandlerDeps } from "../_shared/http/rpc-handler.ts";

export type GrowthAdviceDeps = RpcHandlerDeps;

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
};

export function createGrowthAdviceHandler(deps: GrowthAdviceDeps) {
  return createRpcHandler("growth-advice", GROWTH_ADVICE_ROUTES, deps);
}
