// P32 bloco 4 · porta do relatório ao profissional ("Sua semana" e "Seu mês").
// Servidor: função `analytics` (report.get). Demonstração: a mesma regra do banco sobre a base de exemplo única.
import type { createApiClient } from "../../lib/api/client.ts";
import { DEMO_OPEN_RECEIVABLES, DEMO_TZ, DEMO_WEEKLY_HOURS, demoNow, demoPayments, demoVisits } from "../../lib/demo/dataset.ts";
import { addDays, localParts, weekStart, zonedInstant } from "../../lib/time.ts";
import { ReportOutput } from "../../../supabase/functions/analytics/report.ts";

export type { ReportMetric, ReportOutput } from "../../../supabase/functions/analytics/report.ts";
export type ReportKind = "week" | "month";

type Call = ReturnType<typeof createApiClient>;

export interface ReportPort {
  readonly kind: "demo" | "server";
  now(): Date;
  report(kind: ReportKind, ref: string): Promise<ReportOutput>;
}

export function createServerReportPort(call: Call, tenantId: string): ReportPort {
  return {
    kind: "server",
    now: () => new Date(),
    async report(kind, ref) {
      return (await call("/analytics/report.get", ReportOutput, { method: "POST", tenantId, body: { kind, ref } })).data;
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Regra do relatório (a mesma de public.report_period), sobre dados já no formato da demonstração.

export interface ReportVisit { customer_id: string | null; starts_at: string; status: string }
export interface ReportPayment { amount_cents: number; received_at: string }
export interface ReportData {
  timezone: string;
  visits: readonly ReportVisit[];
  payments: readonly ReportPayment[];
  open: { amount_cents: number }[];
  /** Expediente por dia da semana (0 = domingo): pares "HH:MM". */
  hours: Record<number, { open: [string, string][] }>;
}

/** Início, fim e início do período anterior (datas locais) da semana (segunda a domingo) ou do mês de `ref`. */
export function reportBounds(kind: ReportKind, ref: string): { start: string; end: string; prevStart: string } {
  if (kind === "week") {
    const start = weekStart(ref);
    return { start, end: addDays(start, 7), prevStart: addDays(start, -7) };
  }
  const [y, m] = ref.split("-").map(Number) as [number, number];
  const fmt = (yy: number, mm: number) => `${yy}-${String(mm).padStart(2, "0")}-01`;
  return { start: fmt(y, m), end: m === 12 ? fmt(y + 1, 1) : fmt(y, m + 1), prevStart: m === 1 ? fmt(y - 1, 12) : fmt(y, m - 1) };
}

const metric = (value: number, den: number, min: number, note: string) =>
  ({ value: den >= min ? value : null, denominator: den, status: den >= min ? ("ok" as const) : ("insufficient" as const), note });

export function computeReport(data: ReportData, kind: ReportKind, ref: string, now: Date): ReportOutput {
  const tz = data.timezone;
  const b = reportBounds(kind, ref);
  const from = zonedInstant(b.start, "00:00", tz).getTime();
  const to = zonedInstant(b.end, "00:00", tz).getTime();
  const prevFrom = zonedInstant(b.prevStart, "00:00", tz).getTime();
  if (from > now.getTime()) throw new Error("período futuro");
  const end = Math.min(to, now.getTime());
  const t = (iso: string) => Date.parse(iso);
  const inP = data.visits.filter((v) => t(v.starts_at) >= from && t(v.starts_at) < end);
  const done = inP.filter((v) => v.status === "completed").length;
  const noShow = inP.filter((v) => v.status === "no_show").length;
  const past = inP.filter((v) => ["completed", "no_show", "confirmed"].includes(v.status)).length;
  const received = data.payments.filter((p) => t(p.received_at) >= from && t(p.received_at) < end).reduce((s, p) => s + p.amount_cents, 0);
  const seen = new Set(inP.filter((v) => v.status === "completed" && v.customer_id).map((v) => v.customer_id!));
  const before = new Set(data.visits.filter((v) => v.status === "completed" && v.customer_id && t(v.starts_at) < from).map((v) => v.customer_id!));
  const prev = new Set(data.visits.filter((v) => v.status === "completed" && v.customer_id && t(v.starts_at) >= prevFrom && t(v.starts_at) < from).map((v) => v.customer_id!));
  const now_ = new Set(data.visits.filter((v) => ["completed", "confirmed", "held"].includes(v.status) && v.customer_id && t(v.starts_at) >= from && t(v.starts_at) < to).map((v) => v.customer_id!));

  const open: { weekday: number; hour: number }[] = [];
  for (const [wd, day] of Object.entries(data.hours)) {
    for (const [a, z] of day.open) {
      const h0 = Number(a.slice(0, 2));
      const h1 = Number(z.slice(0, 2)) - (z.slice(3) === "00" ? 1 : 0);
      for (let h = h0; h <= h1; h++) if (!open.some((o) => o.weekday === Number(wd) && o.hour === h)) open.push({ weekday: Number(wd), hour: h });
    }
  }
  const used = new Map<string, number>();
  for (const v of inP.filter((x) => ["completed", "no_show", "confirmed"].includes(x.status))) {
    const p = localParts(v.starts_at, tz);
    const key = `${p.weekday}|${Math.floor(p.minutesOfDay / 60)}`;
    used.set(key, (used.get(key) ?? 0) + 1);
  }
  const slots = open.map((o) => ({ ...o, count: used.get(`${o.weekday}|${o.hour}`) ?? 0 }))
    .sort((x, y) => x.weekday - y.weekday || x.hour - y.hour);
  const busiest = [...slots].sort((x, y) => y.count - x.count || x.weekday - y.weekday || x.hour - y.hour)[0] ?? null;
  const quietest = [...slots].sort((x, y) => x.count - y.count || x.weekday - y.weekday || x.hour - y.hour)[0] ?? null;
  const hoursOk = past >= 5 && slots.length > 0;
  const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
  return {
    kind, period: { starts_at: iso(from), ends_at: iso(to) }, until: iso(end), in_progress: to > now.getTime(), timezone: tz, as_of: iso(now.getTime()),
    services_done: metric(done, past, 1, "Feitos entre os atendimentos que já começaram no período (feitos, faltas e os confirmados sem desfecho)."),
    no_shows: metric(noShow, done + noShow, 1, "Faltas entre os atendimentos com desfecho (feitos e faltas)."),
    received_cents: { value: received, status: "ok", note: "Recebimentos registrados no período, sem os estornados." },
    to_receive_cents: { value: data.open.reduce((s, o) => s + o.amount_cents, 0), denominator: data.open.length, status: "ok", note: "Em aberto agora (cobrado e não pago), de qualquer data." },
    returned: metric([...seen].filter((c) => before.has(c)).length, seen.size, 1, "Clientes atendidos no período que já tinham vindo antes, entre os clientes atendidos no período."),
    not_returned: metric([...prev].filter((c) => !now_.has(c)).length, prev.size, 1, "Clientes do período anterior sem atendimento feito nem marcado neste período, entre os clientes do período anterior."),
    busiest: hoursOk ? busiest : null,
    quietest: hoursOk ? quietest : null,
    hours_status: slots.length === 0 ? "no_hours" : past < 5 ? "insufficient" : "ok",
    hours_denominator: past,
    hours_note: "Por dia da semana e hora cheia do expediente, contando feitos, faltas e confirmados. Precisa de pelo menos 5 atendimentos.",
  };
}

export function createDemoReportPort(): ReportPort {
  return {
    kind: "demo",
    now: demoNow,
    async report(kind, ref) {
      return computeReport({
        timezone: DEMO_TZ, visits: demoVisits(), payments: demoPayments(), open: [...DEMO_OPEN_RECEIVABLES], hours: DEMO_WEEKLY_HOURS,
      }, kind, ref, demoNow());
    },
  };
}
