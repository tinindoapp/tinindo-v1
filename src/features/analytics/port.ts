// Porta do módulo Resultado (P18). Demonstração: dados sintéticos com as mesmas regras; servidor: Edge Function `analytics`.
import type { AnalyticsBaseline, AnalyticsMetricsOutput, CostToServeOutput, TimeRange } from "@contracts";
import type { z } from "zod";

export type CostToServe = z.infer<typeof CostToServeOutput>;

export interface AnalyticsPort {
  readonly kind: "demo" | "server";
  now(): Date;
  timezone(): Promise<string>;
  metrics(period: TimeRange, baselineId: string | null): Promise<AnalyticsMetricsOutput>;
  baselines(): Promise<AnalyticsBaseline[]>;
  createBaseline(label: string, period: TimeRange, key: string): Promise<AnalyticsBaseline>;
}

export interface CostPort {
  readonly kind: "demo" | "server";
  costToServe(period: TimeRange, hourlyCostCents: number): Promise<CostToServe>;
}

export const newKey = () => crypto.randomUUID();
