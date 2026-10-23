// EMULAÇÃO do Resultado para a demonstração sem servidor: números SINTÉTICOS de uma agenda de exemplo, calculados
// com as mesmas definições do banco (denominador explícito, insuficiente ≠ zero, lembretes indisponíveis, baseline
// congelada só com período encerrado, causalidade nunca atribuída). Nada sai do navegador.
import { type AnalyticsBaseline, type AnalyticsMetricsOutput, DEFAULT_MESSAGES, ERROR_STATUS, type ErrorCode, type Metric, RETRYABLE, type TimeRange } from "@contracts";
import { FIXED_NOW, tenantA } from "@contracts/fixtures.ts";
import { ApiError } from "../../lib/api/client.ts";
import { ratioMetric } from "./format.ts";
import type { AnalyticsPort, CostPort } from "./port.ts";

function fail(code: ErrorCode, field?: string): never {
  throw new ApiError(code, DEFAULT_MESSAGES[code], ERROR_STATUS[code], crypto.randomUUID(), RETRYABLE.has(code), field);
}
const now = () => new Date(FIXED_NOW);
const DAY = 86_400_000;
const NOTE = "Comparação antes/depois no mesmo negócio. A diferença não prova que a Tinindo causou a mudança: época do ano, preços, clientes e registro incompleto também mudam os números.";

/** Agenda sintética: seg–sex com 600 min vendáveis; padrão fixo por dia. */
function compute(p: TimeRange): Pick<AnalyticsMetricsOutput, "metrics" | "coverage"> {
  const from = Date.parse(p.starts_at);
  const to = Date.parse(p.ends_at);
  const nowMs = now().getTime();
  let sell = 0, booked = 0, done = 0, noShow = 0, cancel = 0, charged = 0, received = 0, spent = 0, pending = 0;
  for (let t = from; t < to; t += DAY) {
    const d = new Date(t - 3 * 3_600_000);
    const i = Math.floor(t / DAY);
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    sell += 600;
    booked += 240 + (i % 3) * 60;
    if (t + DAY <= nowMs) {
      const c = 5 + (i % 2);
      done += c;
      noShow += i % 3 === 0 ? 1 : 0;
      cancel += i % 4 === 0 ? 1 : 0;
      charged += c - (i % 5 === 0 ? 1 : 0);
      received += (c - (i % 5 === 0 ? 1 : 0)) * 5000;
      spent += d.getUTCDay() === 1 ? 3000 : 0;
    } else if (t <= nowMs) {
      pending += 1;
    }
  }
  const m = (key: Metric["key"], label: string, unit: Metric["unit"], part: Pick<Metric, "numerator" | "denominator" | "value" | "status">, note: string): Metric =>
    ({ key, label, unit, note, ...part });
  const metrics: Metric[] = [
    m("occupancy", "Ocupação", "ratio", ratioMetric(booked, sell), "Minutos reservados (confirmados, concluídos e faltas) dentro do expediente vendável (expediente menos bloqueios). Holds, cancelados e intervalos não contam."),
    m("no_show", "Faltas", "ratio", ratioMetric(noShow, done + noShow), "Faltas sobre atendimentos com desfecho (concluídos + faltas) já ocorridos. Futuros, cancelados e sem desfecho ficam fora."),
    m("cancellation", "Cancelamentos", "ratio", ratioMetric(cancel, done + noShow + cancel), "Cancelados sobre concluídos, faltas e cancelados com início no período, até agora."),
    m("waitlist_acceptance", "Ofertas de vaga aceitas", "ratio", ratioMetric(0, 0), "Ofertas aceitas sobre ofertas preparadas. Aceitar não é comparecer nem pagar."),
    m("quote_acceptance", "Orçamentos aceitos", "ratio", ratioMetric(0, 0), "Aceitos sobre orçamentos com link gerado no período (inclui ainda abertos e vencidos). Aceito não é pago."),
    m("received", "Recebimentos registrados", "cents", { numerator: received, denominator: null, value: received, status: "ok" }, "Soma do que foi lançado como recebido, já descontados estornos. Não é lucro, saldo bancário nem receita causada pela Tinindo."),
    m("expenses", "Despesas registradas", "cents", { numerator: spent, denominator: null, value: spent, status: "ok" }, "Soma das despesas lançadas, já descontados estornos."),
    m("charge_coverage", "Atendimentos com cobrança registrada", "ratio", ratioMetric(charged, done), "Concluídos com cobrança ou crédito de pacote lançado. Mede a qualidade do registro, não o recebimento."),
    m("human_minutes", "Minutos da equipe Tinindo", "minutes", { numerator: 0, denominator: null, value: 0, status: "ok" }, "Minutos humanos medidos em serviços assistidos. Automação: 0 min; retrabalho: 0 min."),
    m("reminders", "Lembretes enviados", "ratio", { numerator: 3, denominator: 4, value: 0.75, status: "ok" }, "Atendimentos com cliente que tiveram lembrete enviado ao canal ou compartilhado pelo profissional, sobre os atendimentos do período. Enviado não é entregue nem lido."),
  ];
  const coverage: AnalyticsMetricsOutput["coverage"] = [];
  if (to > nowMs) coverage.push({ key: "future", count: null, note: "O período inclui dias futuros: faltas e cancelamentos contam só até agora; ocupação inclui reservas futuras." });
  if (pending > 0) coverage.push({ key: "pending_outcome", count: pending, note: "Atendimentos já passados ainda como confirmados (sem concluir nem marcar falta): fora das taxas." });
  if (done - charged > 0) coverage.push({ key: "uncharged", count: done - charged, note: "Atendimentos concluídos sem cobrança registrada: os recebimentos podem estar incompletos." });
  return { metrics, coverage };
}

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
