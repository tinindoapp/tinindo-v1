// A regra da demonstração é a mesma do banco: os mesmos números do pgTAP 60 sobre os mesmos dados sintéticos.
import { describe, expect, it } from "vitest";
import { addDays, zonedInstant } from "../../lib/time.ts";
import { computeForecast, createDemoForecastPort, type ForecastVisit } from "./forecastPort.ts";

const TZ = "America/Sao_Paulo";
const v = (date: string, hhmm: string, status: string): ForecastVisit => {
  const s = zonedInstant(date, hhmm, TZ).getTime();
  return { starts_at: new Date(s).toISOString(), ends_at: new Date(s + 3_600_000).toISOString(), status };
};
const visits: ForecastVisit[] = [];
for (let j = 1; j <= 12; j++) {
  const m = addDays("2026-11-09", -7 * j);
  visits.push(v(m, "09:00", "completed"), v(m, "10:00", "completed"), v(addDays(m, 1), "09:00", "completed"));
  if (j % 2 === 0) visits.push(v(addDays(m, 1), "10:00", "completed"), v(addDays(m, 1), "11:00", "completed"));
  visits.push(v(addDays(m, 3), "11:00", j <= 4 ? "no_show" : "completed"));
}
visits.push(v("2026-11-16", "09:00", "confirmed"));
const hours = Object.fromEntries([1, 2, 3, 4, 5].map((wd) => [wd, { open: [["09:00", "12:00"]] as [string, string][] }]));
const data = { timezone: TZ, visits, hours };
const now = new Date("2026-11-21T12:00:00Z");

describe("previsão simples (mesma regra do banco)", () => {
  it("só com 8 semanas fechadas", () => {
    const f = computeForecast(data, "2026-09-10", now);
    expect(f).toMatchObject({ status: "insufficient", weeks_of_history: 3, weeks_needed: 8, days: [], accuracy: null });
  });

  it("semana futura é recusada", () => {
    expect(() => computeForecast(data, "2026-12-20", now)).toThrow();
  });

  it("ocupação por dia, risco por horário e acerto contra a referência", () => {
    const f = computeForecast(data, "2026-11-12", now);
    expect(f.status).toBe("ok");
    expect(f.target.starts_at).toBe("2026-11-16T03:00:00Z");
    expect(f.days.find((d) => d.weekday === 1)).toEqual({ date: "2026-11-16", weekday: 1, expected_bookings: 2, already_booked: 1, open_minutes: 180, expected_occupancy: 0.67 });
    expect(f.days.find((d) => d.weekday === 2)!.expected_bookings).toBe(2);
    expect(f.days.find((d) => d.weekday === 0)!.expected_occupancy).toBeNull();
    expect(f.no_show_slots.find((s) => s.weekday === 4 && s.hour === 11)).toMatchObject({ denominator: 8, no_shows: 4, basis: "slot", risk: 0.5 });
    expect(f.no_show_slots.find((s) => s.weekday === 5 && s.hour === 9)).toMatchObject({ basis: "overall", risk: 0.1 });
    expect(f.overall_no_show).toEqual({ denominator: 40, no_shows: 4, risk: 0.1 });
    expect(f.backtest).toHaveLength(4);
    expect(f.accuracy).toMatchObject({ weeks: 4, actual: 20, model_accuracy: 0.8, baseline_accuracy: 0.6, beats_baseline: true });
  });

  it("a demonstração tem menos de 8 semanas: diz dados insuficientes", async () => {
    const p = createDemoForecastPort();
    const f = await p.forecast("2026-10-20");
    expect(f.status).toBe("insufficient");
    expect(f.weeks_of_history).toBeLessThan(8);
  });
});
