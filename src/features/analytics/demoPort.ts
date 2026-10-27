// EMULAÇÃO do Resultado para a demonstração sem servidor: números da base de exemplo única (dataset.ts), calculados
// com as mesmas definições do banco (denominador explícito, insuficiente ≠ zero, lembretes indisponíveis, baseline
// congelada só com período encerrado, causalidade nunca atribuída). Nada sai do navegador.
import { type AnalyticsBaseline, type AnalyticsMetricsOutput, DEFAULT_MESSAGES, ERROR_STATUS, type ErrorCode, RETRYABLE, type TimeRange } from "@contracts";
import { FIXED_NOW, tenantA } from "@contracts/fixtures.ts";
import { ApiError } from "../../lib/api/client.ts";
import { demoMetrics } from "../../lib/demo/dataset.ts";
import type { AnalyticsPort, CostPort } from "./port.ts";

function fail(code: ErrorCode, field?: string): never {
  throw new ApiError(code, DEFAULT_MESSAGES[code], ERROR_STATUS[code], crypto.randomUUID(), RETRYABLE.has(code), field);
}
const now = () => new Date(FIXED_NOW);
const NOTE = "Comparação antes/depois no mesmo negócio. A diferença não prova que a Tinindo causou a mudança: época do ano, preços, clientes e registro incompleto também mudam os números.";

/** Indicadores da base de exemplo única (src/lib/demo/dataset.ts): os mesmos números do Caixa, das Metas e do Assistente. */
const compute = (p: TimeRange): Pick<AnalyticsMetricsOutput, "metrics" | "coverage"> => demoMetrics(p, now());

let baselines: AnalyticsBaseline[] = [];
const idem = new Map<string, AnalyticsBaseline>();
/** Só para testes. */
export function resetDemoState() {
  baselines = [];
  idem.clear();
}

export function createDemoPort(): AnalyticsPort {
  return {
    kind: "demo",
    now,
    async timezone() {
      return tenantA.timezone;
    },
    async metrics(period, baselineId) {
      const cur = compute(period);
      const b = baselineId ? baselines.find((x) => x.id === baselineId) ?? fail("NOT_FOUND", "baseline_id") : null;
      return structuredClone({
        period, timezone: tenantA.timezone, as_of: now().toISOString(), ...cur, baseline: b,
        comparison: b ? cur.metrics.map((c) => {
          const old = b.metrics.find((x) => x.key === c.key);
          const delta = c.value !== null && old?.value != null ? Math.round((c.value - old.value) * 10_000) / 10_000 : null;
          return { key: c.key, baseline_value: old?.value ?? null, current_value: c.value, delta };
        }) : null,
        causality: "not_established" as const, comparison_note: NOTE,
      });
    },
    async baselines() {
      return structuredClone(baselines);
    },
    async createBaseline(label, period, key) {
      const hit = idem.get(key);
      if (hit) return structuredClone(hit);
      if (Date.parse(period.ends_at) > now().getTime()) fail("VALIDATION_ERROR", "period");
      const b: AnalyticsBaseline = { id: crypto.randomUUID(), label, period, ...compute(period), created_at: now().toISOString() };
      baselines = [b, ...baselines];
      idem.set(key, b);
      return structuredClone(b);
    },
  };
}

export function createDemoCostPort(): CostPort {
  return {
    kind: "demo",
    async costToServe(period, hourly) {
      const human = 95;
      return {
        period, hourly_cost_cents: hourly, as_of: now().toISOString(),
        tenants: [{ tenant_id: tenantA.id, tenant_name: tenantA.name, human_minutes: human, automation_minutes: 20, reprocess_minutes: 15,
          estimated_cost_cents: Math.round((human * hourly) / 60), plan_monthly_cents: 7900, services_contracted_cents: 50000 }],
        totals: { human_minutes: human, automation_minutes: 20, reprocess_minutes: 15, estimated_cost_cents: Math.round((human * hourly) / 60) },
        note: "Custo estimado = minutos humanos medidos × custo-hora informado; não inclui infraestrutura, canal, impostos nem aquisição. Valores contratados têm cobrança manual: não são pagamentos confirmados.",
      };
    },
  };
}
