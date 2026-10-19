// Resultado e custo (P18). Aditivos ao v1; ver ADR-0015.
// Todo indicador traz numerador, denominador e estado; "insuficiente" e "indisponível" nunca viram zero.
// A comparação com a baseline é antes/depois: causality é sempre "not_established".
import { z } from "zod";
import { Cents, IsoDateTime, TimeRange, Uuid } from "./common.ts";

export const MetricKey = z.enum([
  "occupancy", "no_show", "cancellation", "waitlist_acceptance", "quote_acceptance", "received", "expenses",
  "charge_coverage", "human_minutes", "reminders",
]);
export type MetricKey = z.infer<typeof MetricKey>;

export const Metric = z.object({
  key: MetricKey,
  label: z.string(),
  unit: z.enum(["ratio", "minutes", "cents"]),
  numerator: z.number().nullable(),
  denominator: z.number().nullable(),
  /** ratio: 0–1 com 4 casas; null quando insuficiente ou indisponível. */
  value: z.number().nullable(),
  /** insufficient = denominador zero ou dado de base ausente; unavailable = a fonte ainda não existe. */
  status: z.enum(["ok", "insufficient", "unavailable"]),
  note: z.string(),
});
export type Metric = z.infer<typeof Metric>;

export const CoverageItem = z.object({ key: z.string(), count: z.int().nullable(), note: z.string() });

export const AnalyticsBaseline = z.object({
  id: Uuid,
  label: z.string(),
  period: TimeRange,
  metrics: z.array(Metric),
  coverage: z.array(CoverageItem),
  created_at: IsoDateTime,
});
export type AnalyticsBaseline = z.infer<typeof AnalyticsBaseline>;

export const AnalyticsMetricsInput = z.object({ period: TimeRange, baseline_id: Uuid.nullable().optional() });
export const AnalyticsMetricsOutput = z.object({
  period: TimeRange,
  timezone: z.string(),
  as_of: IsoDateTime,
  metrics: z.array(Metric),
  coverage: z.array(CoverageItem),
  baseline: AnalyticsBaseline.nullable(),
  comparison: z.array(z.object({
    key: MetricKey,
    baseline_value: z.number().nullable(),
    current_value: z.number().nullable(),
    delta: z.number().nullable(),
  })).nullable(),
  causality: z.literal("not_established"),
  comparison_note: z.string(),
});
export type AnalyticsMetricsOutput = z.infer<typeof AnalyticsMetricsOutput>;

/** Baseline: período encerrado (fim ≤ agora); indicadores congelados na criação. */
export const AnalyticsBaselineCreateInput = z.object({ label: z.string().trim().min(1).max(80), period: TimeRange });
export const AnalyticsBaselineOutput = z.object({ baseline: AnalyticsBaseline });
export const AnalyticsBaselineListInput = z.object({});
export const AnalyticsBaselineListOutput = z.object({ baselines: z.array(AnalyticsBaseline).max(20) });

/** Operação Tinindo: custo-hora informado por quem consulta (premissa, não custo contábil). */
export const CostToServeInput = z.object({ period: TimeRange, hourly_cost_cents: z.int().min(0).max(10_000_000) });
export const CostToServeOutput = z.object({
  period: TimeRange,
  hourly_cost_cents: Cents,
  as_of: IsoDateTime,
  tenants: z.array(z.object({
    tenant_id: Uuid,
    tenant_name: z.string(),
    human_minutes: z.int().min(0),
    automation_minutes: z.int().min(0),
    reprocess_minutes: z.int().min(0),
    estimated_cost_cents: Cents,
    /** Preço do plano ativo (cobrança manual, não confirmada). */
    plan_monthly_cents: Cents,
    services_contracted_cents: Cents,
  })),
  totals: z.object({ human_minutes: z.int(), automation_minutes: z.int(), reprocess_minutes: z.int(), estimated_cost_cents: Cents }),
  note: z.string(),
});
