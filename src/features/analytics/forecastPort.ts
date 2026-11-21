// P32 bloco 5 · porta da previsão simples. Servidor: função `analytics` (forecast.get). Demonstração: a mesma regra
// de public.forecast_week sobre a base de exemplo (que tem menos de 8 semanas: mostra "dados insuficientes").
import type { createApiClient } from "../../lib/api/client.ts";
import { DEMO_TZ, DEMO_WEEKLY_HOURS, demoNow, demoVisits } from "../../lib/demo/dataset.ts";
import { addDays, localParts, weekStart, zonedInstant } from "../../lib/time.ts";
import { ForecastOutput } from "../../../supabase/functions/analytics/forecast.ts";

export type { ForecastOutput } from "../../../supabase/functions/analytics/forecast.ts";

type Call = ReturnType<typeof createApiClient>;

export interface ForecastPort {
  readonly kind: "demo" | "server";
  now(): Date;
  forecast(ref: string): Promise<ForecastOutput>;
}

export function createServerForecastPort(call: Call, tenantId: string): ForecastPort {
  return {
    kind: "server",
    now: () => new Date(),
    async forecast(ref) {
      return (await call("/analytics/forecast.get", ForecastOutput, { method: "POST", tenantId, body: { ref } })).data;
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Regra da previsão (a mesma de public.forecast_week).

export interface ForecastVisit { starts_at: string; ends_at: string; status: string }
export interface ForecastData {
  timezone: string;
  visits: readonly ForecastVisit[];
  /** Expediente por dia da semana (0 = domingo): pares "HH:MM". */
  hours: Record<number, { open: [string, string][] }>;
}

const OCCUPIED = ["completed", "no_show", "confirmed"];
const round = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

export function computeForecast(data: ForecastData, ref: string, now: Date): ForecastOutput {
  const tz = data.timezone;
  const cw = weekStart(ref);
  const at = (date: string) => zonedInstant(date, "00:00", tz).getTime();
  if (at(cw) > now.getTime()) throw new Error("semana futura");
  const target = addDays(cw, 7);
  const t = (s: string) => Date.parse(s);
  const local = (s: string) => localParts(s, tz);
  /** Semanas fechadas entre a semana de `s` e a semana de `ref` (1 = a última). */
  const weekIndex = (s: string) => Math.round((Date.parse(`${cw}T00:00:00Z`) - Date.parse(`${weekStart(local(s).date)}T00:00:00Z`)) / (7 * 86_400_000));
  const first = data.visits.map((v) => v.starts_at).sort()[0];
  const weeks = first ? Math.max(0, weekIndex(first)) : 0;
  const base = {
    weeks_of_history: weeks, weeks_needed: 8 as const,
    target: { starts_at: iso(at(target)), ends_at: iso(at(addDays(target, 7))) }, timezone: tz, as_of: iso(now.getTime()),
  };
  if (weeks < 8) {
    return { status: "insufficient", ...base, days: [], no_show_slots: [], overall_no_show: null, backtest: [], accuracy: null };
  }
  const from12 = at(addDays(cw, -84));
  const from8 = at(addDays(cw, -56));
  const to = at(cw);
  const grid = new Map<string, { n: number; min: number }>();
  for (const v of data.visits) {
    if (!OCCUPIED.includes(v.status) || t(v.starts_at) < from12 || t(v.starts_at) >= to) continue;
    const k = `${weekIndex(v.starts_at)}|${local(v.starts_at).weekday}`;
    const g = grid.get(k) ?? { n: 0, min: 0 };
    g.n += 1;
    g.min += (t(v.ends_at) - t(v.starts_at)) / 60_000;
    grid.set(k, g);
  }
  const cell = (j: number, wd: number) => grid.get(`${j}|${wd}`) ?? { n: 0, min: 0 };
  const avg = (wd: number, a: number, z: number, f: (c: { n: number; min: number }) => number) => {
    let s = 0;
    for (let j = a; j <= z; j++) s += f(cell(j, wd));
    return s / (z - a + 1);
  };
  const openMin = (wd: number) => (data.hours[wd]?.open ?? []).reduce((s, [a, z]) => s + minutes(z) - minutes(a), 0);
  const ahead = new Map<number, number>();
  for (const v of data.visits) {
    if (!["confirmed", "held"].includes(v.status) || t(v.starts_at) < at(target) || t(v.starts_at) >= at(addDays(target, 7))) continue;
    const wd = local(v.starts_at).weekday;
    ahead.set(wd, (ahead.get(wd) ?? 0) + 1);
  }
  const days = [1, 2, 3, 4, 5, 6, 0].map((wd) => {
    const om = openMin(wd);
    return {
      date: addDays(target, (wd + 6) % 7), weekday: wd,
      expected_bookings: round(avg(wd, 1, 8, (c) => c.n), 1),
      already_booked: ahead.get(wd) ?? 0,
      open_minutes: om,
      expected_occupancy: om > 0 ? round(Math.min(avg(wd, 1, 8, (c) => c.min) / om, 1), 2) : null,
    };
  });

  const outcome = data.visits.filter((v) => ["completed", "no_show"].includes(v.status) && t(v.starts_at) >= from8 && t(v.starts_at) < to);
  const overallN = outcome.length;
  const overallNs = outcome.filter((v) => v.status === "no_show").length;
  const overallRisk = overallN > 0 ? round(overallNs / overallN, 2) : null;
  const bySlot = new Map<string, { n: number; ns: number }>();
  for (const v of outcome) {
    const p = local(v.starts_at);
    const k = `${p.weekday}|${Math.floor(p.minutesOfDay / 60)}`;
    const s = bySlot.get(k) ?? { n: 0, ns: 0 };
    s.n += 1;
    if (v.status === "no_show") s.ns += 1;
    bySlot.set(k, s);
  }
  const openHours: { wd: number; hour: number }[] = [];
  for (const [wd, day] of Object.entries(data.hours)) {
    for (const [a, z] of day.open) {
      for (let h = Math.floor(minutes(a) / 60); h <= Math.floor((minutes(z) - 1) / 60); h++) {
        if (!openHours.some((o) => o.wd === Number(wd) && o.hour === h)) openHours.push({ wd: Number(wd), hour: h });
      }
    }
  }
  const no_show_slots = openHours.sort((x, y) => (x.wd + 6) % 7 - (y.wd + 6) % 7 || x.hour - y.hour).map((o) => {
    const s = bySlot.get(`${o.wd}|${o.hour}`) ?? { n: 0, ns: 0 };
    const own = s.n >= 3;
    return { weekday: o.wd, hour: o.hour, denominator: s.n, no_shows: s.ns, basis: own ? ("slot" as const) : ("overall" as const), risk: own ? round(s.ns / s.n, 2) : overallRisk };
  });

  const backtest = [4, 3, 2, 1].filter((k) => weeks >= k + 8).map((k) => {
    let actual = 0, predicted = 0, baseline = 0, me = 0, be = 0;
    for (let wd = 0; wd < 7; wd++) {
      const a = cell(k, wd).n, p = avg(wd, k + 1, k + 8, (c) => c.n), b = cell(k + 1, wd).n;
      actual += a; predicted += p; baseline += b; me += Math.abs(p - a); be += Math.abs(b - a);
    }
    return { starts_at: iso(at(addDays(cw, -7 * k))), actual, predicted: round(predicted, 1), baseline, model_error: round(me, 1), baseline_error: be };
  });
  const sum = (f: (w: (typeof backtest)[number]) => number) => backtest.reduce((s, w) => s + f(w), 0);
  const act = sum((w) => w.actual), me = sum((w) => w.model_error), be = sum((w) => w.baseline_error);
  const accuracy = backtest.length === 0 ? null : {
    weeks: backtest.length, actual: act, model_error: round(me, 1), baseline_error: be,
    model_accuracy: act > 0 ? round(Math.max(0, 1 - me / act), 2) : null,
    baseline_accuracy: act > 0 ? round(Math.max(0, 1 - be / act), 2) : null,
    beats_baseline: me < be,
  };
  return { status: "ok", ...base, days, no_show_slots, overall_no_show: { denominator: overallN, no_shows: overallNs, risk: overallRisk }, backtest, accuracy };
}

export function createDemoForecastPort(): ForecastPort {
  return {
    kind: "demo",
    now: demoNow,
    async forecast(ref) {
      return computeForecast({ timezone: DEMO_TZ, visits: demoVisits(), hours: DEMO_WEEKLY_HOURS }, ref, demoNow());
    },
  };
}
