// Portas reais do Resultado: Edge Function `analytics` (+ `context` para o fuso).
import { AnalyticsBaselineListOutput, AnalyticsBaselineOutput, AnalyticsMetricsOutput, ContextResponse, CostToServeOutput } from "@contracts";
import type { createApiClient } from "../../lib/api/client.ts";
import type { AnalyticsPort, CostPort } from "./port.ts";

type Call = ReturnType<typeof createApiClient>;

export function createServerPort(call: Call, tenantId: string): AnalyticsPort {
  const post = (body: unknown, idempotencyKey?: string) => ({ method: "POST" as const, tenantId, body, idempotencyKey });
  return {
    kind: "server",
    now: () => new Date(),
    async timezone() {
      return (await call("/context", ContextResponse, { tenantId })).data.timezone;
    },
    async metrics(period, baselineId) {
      return (await call("/analytics/analytics.metrics", AnalyticsMetricsOutput, post({ period, baseline_id: baselineId }))).data;
    },
    async baselines() {
      return (await call("/analytics/analytics.baseline_list", AnalyticsBaselineListOutput, post({}))).data.baselines;
    },
    async createBaseline(label, period, key) {
      return (await call("/analytics/analytics.baseline_create", AnalyticsBaselineOutput, post({ label, period }, key))).data.baseline;
    },
  };
}

/** Operação: sem negócio selecionado; o banco confere se quem pede é operador. */
export function createServerCostPort(call: Call): CostPort {
  return {
    kind: "server",
    async costToServe(period, hourly) {
      return (await call("/analytics/analytics.cost_to_serve", CostToServeOutput, { method: "POST", body: { period, hourly_cost_cents: hourly } })).data;
    },
  };
}
