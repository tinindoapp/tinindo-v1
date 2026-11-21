import { describe, expect, it } from "vitest";
import { computeReport, createDemoReportPort, reportBounds, type ReportData } from "./reportPort.ts";

const TZ = "America/Sao_Paulo";
const at = (date: string, hhmm: string) => new Date(Date.parse(`${date}T${hhmm}:00-03:00`)).toISOString();
const ANA = "ana", BRUNO = "bruno";

// O mesmo cenário de supabase/tests/database/59_p32_relatorio.test.sql: a regra da demonstração é a do banco.
const data: ReportData = {
  timezone: TZ,
  visits: [
    { customer_id: ANA, starts_at: at("2026-11-03", "09:00"), status: "completed" },
    { customer_id: BRUNO, starts_at: at("2026-11-04", "10:00"), status: "completed" },
    { customer_id: ANA, starts_at: at("2026-11-10", "09:00"), status: "completed" },
    { customer_id: ANA, starts_at: at("2026-11-11", "09:00"), status: "completed" },
    { customer_id: null, starts_at: at("2026-11-10", "09:45"), status: "completed" },
    { customer_id: null, starts_at: at("2026-11-17", "09:00"), status: "completed" },
    { customer_id: null, starts_at: at("2026-11-12", "11:00"), status: "no_show" },
    { customer_id: null, starts_at: at("2026-11-13", "09:00"), status: "completed" },
  ],
  payments: [{ amount_cents: 6000, received_at: "2026-11-10T13:00:00Z" }],
  open: [{ amount_cents: 4000 }],
  hours: Object.fromEntries([1, 2, 3, 4, 5].map((wd) => [wd, { open: [["09:00", "12:00"]] as [string, string][] }])),
};
const NOW = new Date("2026-11-21T12:00:00Z");

describe("relatório · regra", () => {
  it("semana de segunda a domingo e mês do calendário", () => {
    expect(reportBounds("week", "2026-11-12")).toEqual({ start: "2026-11-09", end: "2026-11-16", prevStart: "2026-11-02" });
    expect(reportBounds("month", "2026-01-15")).toEqual({ start: "2026-01-01", end: "2026-02-01", prevStart: "2025-12-01" });
  });
  it("mesmos números do banco (pgTAP 59)", () => {
    const r = computeReport(data, "week", "2026-11-12", NOW);
    expect(r.period).toEqual({ starts_at: "2026-11-09T03:00:00Z", ends_at: "2026-11-16T03:00:00Z" });
    expect(r.services_done).toMatchObject({ value: 4, denominator: 5, status: "ok" });
    expect(r.no_shows.value).toBe(1);
    expect(r.received_cents.value).toBe(6000);
    expect(r.to_receive_cents.value).toBe(4000);
    expect(r.returned).toMatchObject({ value: 1, denominator: 1 });
    expect(r.not_returned).toMatchObject({ value: 1, denominator: 2 });
    expect(r.busiest).toEqual({ weekday: 2, hour: 9, count: 2 });
    expect(r.quietest?.count).toBe(0);
  });
  it("sem base: insuficiente, nunca zero", () => {
    const r = computeReport(data, "week", "2026-10-12", NOW);
    expect(r.services_done).toMatchObject({ value: null, denominator: 0, status: "insufficient" });
    expect(r.hours_status).toBe("insufficient");
    expect(r.busiest).toBeNull();
  });
  it("período futuro é recusado; período em andamento termina agora", () => {
    expect(() => computeReport(data, "week", "2026-12-20", NOW)).toThrow();
    const r = computeReport(data, "week", "2026-11-21", NOW);
    expect(r.in_progress).toBe(true);
    expect(r.until).toBe("2026-11-21T12:00:00Z");
  });
  it("demonstração responde com a base de exemplo", async () => {
    const r = await createDemoReportPort().report("week", "2026-10-12");
    expect(r.services_done.status).toBe("ok");
    expect(r.received_cents.value).toBeGreaterThan(0);
  });
});
