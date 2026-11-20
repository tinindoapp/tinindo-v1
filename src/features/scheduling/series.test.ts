import { describe, expect, it } from "vitest";
import { type Booking, IdempotencyKey } from "@contracts";
import { describeSeries, planSeries, seriesCallKey, seriesLabel, seriesMark, seriesRemaining } from "./series.ts";

const tz = "America/Sao_Paulo";
/** Terça 20/10/2026, 09:00 em São Paulo (relógio da demonstração). */
const now = new Date("2026-10-20T12:00:00Z");
const base = { startDate: "2026-10-20", weekdays: [4, 2], time: "07:00", durationMin: 60, timeZone: tz, now };

describe("repetição semanal: montagem do pedido", () => {
  it("terça e quinta às 7h por 8 semanas: UMA chamada (um series_id), 16 datas em ordem", () => {
    const plan = planSeries({ ...base, end: { kind: "weeks", weeks: 8 } });
    if (!plan.ok) throw new Error(plan.message);
    // Terça 20/10 às 07:00 já passou: a primeira data é a quinta 22/10, e a terça começa na semana seguinte.
    expect(plan.calls.map((c) => [c.weekdays, c.weeks, c.occurrences[0]!.date, c.occurrences.length])).toEqual([[[2, 4], 8, "2026-10-22", 16]]);
    expect(plan.occurrences).toHaveLength(16);
    expect(plan.occurrences[0]).toEqual({
      date: "2026-10-22",
      slot: { starts_at: "2026-10-22T07:00:00-03:00", ends_at: "2026-10-22T08:00:00-03:00" },
    });
    expect(plan.occurrences.at(-1)!.date).toBe("2026-12-15");
    const starts = plan.occurrences.map((o) => Date.parse(o.slot.starts_at));
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
  });

  it("até uma data: conta as semanas de cada dia e recusa menos de 2 ou mais de 12", () => {
    const start = { ...base, startDate: "2026-10-27" };
    const plan = planSeries({ ...start, end: { kind: "until", date: "2026-11-12" } });
    if (!plan.ok) throw new Error(plan.message);
    // As duas com 3 semanas: uma chamada só.
    expect(plan.calls.map((c) => [c.weekdays, c.weeks])).toEqual([[[2, 4], 3]]);
    // Data no meio da semana: terça com 3, quinta com 2 → uma chamada por dia (cada uma com o seu series_id).
    const uneven = planSeries({ ...start, end: { kind: "until", date: "2026-11-10" } });
    if (!uneven.ok) throw new Error(uneven.message);
    expect(uneven.calls.map((c) => [c.weekdays, c.weeks])).toEqual([[[2], 3], [[4], 2]]);
    expect(plan.occurrences.at(-1)!.date).toBe("2026-11-12");

    expect(planSeries({ ...start, end: { kind: "until", date: "2026-11-04" } })).toMatchObject({
      ok: false, field: "end", message: expect.stringContaining("quinta teria só 1 atendimento"),
    });
    expect(planSeries({ ...start, end: { kind: "until", date: "2026-10-26" } })).toMatchObject({
      ok: false, field: "end", message: expect.stringContaining("terça não teria nenhum atendimento"),
    });
    expect(planSeries({ ...start, end: { kind: "until", date: "2027-06-30" } })).toMatchObject({
      ok: false, field: "end", message: expect.stringContaining("até 12 semanas por vez"),
    });
  });

  it("valida dias, horário e número de semanas", () => {
    const end = { kind: "weeks" as const, weeks: 4 };
    expect(planSeries({ ...base, weekdays: [], end })).toMatchObject({ ok: false, field: "weekdays" });
    expect(planSeries({ ...base, time: "", end })).toMatchObject({ ok: false, field: "time" });
    expect(planSeries({ ...base, time: "25:00", end })).toMatchObject({ ok: false, field: "time" });
    for (const weeks of [1, 13, 2.5, Number.NaN]) {
      expect(planSeries({ ...base, end: { kind: "weeks", weeks } })).toMatchObject({ ok: false, field: "end" });
    }
  });

  it("descreve os dias na ordem da semana e deriva chaves aceitas pelo contrato", () => {
    expect(describeSeries([4, 2], "07:00")).toBe("terça e quinta, às 07:00");
    expect(describeSeries([0, 6, 1], "18:30")).toBe("segunda, sábado e domingo, às 18:30");
    const key = seriesCallKey("7a1f8a52-2b0c-4b4e-9f1e-3c0f6b5d2a10", { weekdays: [2, 4] });
    expect(key).toBe("7a1f8a52-2b0c-4b4e-9f1e-3c0f6b5d2a10-d24");
    expect(IdempotencyKey.safeParse(key).success).toBe(true);
  });

  it("indicador: posição na repetição (lida do servidor) e o próximo ainda marcado", () => {
    const b = (id: string, day: number, status: Booking["status"] = "confirmed") =>
      ({ id, starts_at: `2026-10-${String(day).padStart(2, "0")}T10:00:00Z`, status }) as Booking;
    const series = [b("c", 29), b("a", 15), b("b", 22, "cancelled"), b("d", 30)];
    expect(seriesMark(series, "a")).toEqual({ position: 1, total: 4, nextId: "c" });
    expect(seriesMark(series, "d")).toEqual({ position: 4, total: 4, nextId: null });
    expect(seriesMark(series, "z")).toBeNull();
    expect(seriesMark([b("a", 15)], "a")).toBeNull();
    expect(seriesRemaining(series, b("a", 15))).toBe(3);
    expect(seriesLabel({ position: 3, total: 16, nextId: null })).toBe("Repete toda semana · 3 de 16");
  });
});
