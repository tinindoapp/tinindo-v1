// Edge Function `analytics` (P18): indicadores com denominador e cobertura, baseline congelada e custo de
// atendimento por cliente para a operação. Cada operação é uma RPC (ver _shared/http/rpc-handler.ts).
import {
  AnalyticsBaselineCreateInput,
  AnalyticsBaselineListInput,
  AnalyticsBaselineListOutput,
  AnalyticsBaselineOutput,
  AnalyticsMetricsInput,
  AnalyticsMetricsOutput,
  CostToServeInput,
  CostToServeOutput,
} from "../_shared/contracts/index.ts";
import { createRpcHandler, type Route, route, type RpcHandlerDeps } from "../_shared/http/rpc-handler.ts";

export type AnalyticsDeps = RpcHandlerDeps;

const period = (p: { starts_at: string; ends_at: string }) => ({ p_from: p.starts_at, p_to: p.ends_at });

export const ANALYTICS_ROUTES: Record<string, Route> = {
  "analytics.metrics": route({
    rpc: "analytics_metrics", input: AnalyticsMetricsInput, output: AnalyticsMetricsOutput, command: false,
    args: (i) => ({ ...period(i.period), p_baseline_id: i.baseline_id ?? null }),
  }),
  "analytics.baseline_create": route({
    rpc: "analytics_baseline_create", input: AnalyticsBaselineCreateInput, output: AnalyticsBaselineOutput, command: true,
    args: (i) => ({ p_label: i.label, ...period(i.period) }),
  }),
  "analytics.baseline_list": route({
    rpc: "analytics_baseline_list", input: AnalyticsBaselineListInput, output: AnalyticsBaselineListOutput, command: false,
    args: () => ({}),
  }),
  "analytics.cost_to_serve": route({
    rpc: "analytics_cost_to_serve", input: CostToServeInput, output: CostToServeOutput, command: false, tenant: false,
    args: (i) => ({ ...period(i.period), p_hourly_cost_cents: i.hourly_cost_cents }),
  }),
};

export const createAnalyticsHandler = (deps: AnalyticsDeps) => createRpcHandler("analytics", ANALYTICS_ROUTES, deps);
