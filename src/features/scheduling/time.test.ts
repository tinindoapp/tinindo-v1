import { describe, expect, it } from "vitest";
import { addDays, dayWindow, formatTime, isCivilDate, localParts, toZonedIso, weekStart, zonedInstant } from "./time.ts";

const SP = "America/Sao_Paulo";

describe("tempo no fuso do negócio", () => {
  it("converte horário local de São Paulo em instante com offset -03:00", () => {
    expect(zonedInstant("2026-10-20", "09:00", SP).toISOString()).toBe("2026-10-20T12:00:00.000Z");
    expect(toZonedIso("2026-10-20T12:00:00Z", SP)).toBe("2026-10-20T09:00:00-03:00");
  });

  it("exibe o horário do negócio independentemente do fuso do navegador", () => {
    expect(formatTime("2026-10-20T09:00:00-03:00", SP)).toBe("09:00");
    expect(localParts("2026-10-21T02:30:00Z", SP)).toMatchObject({ date: "2026-10-20", time: "23:30", weekday: 2 });
  });

  it("janela do dia é semiaberta e respeita dias de 23 h na mudança de horário", () => {
    expect(dayWindow("2026-10-20", SP)).toEqual({
      starts_at: "2026-10-20T00:00:00-03:00",
      ends_at: "2026-10-21T00:00:00-03:00",
    });
    const ny = dayWindow("2026-03-08", "America/New_York");
    expect(ny).toEqual({ starts_at: "2026-03-08T00:00:00-05:00", ends_at: "2026-03-09T00:00:00-04:00" });
    expect((Date.parse(ny.ends_at) - Date.parse(ny.starts_at)) / 3_600_000).toBe(23);
  });

  it("aritmética de datas civis", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(weekStart("2026-10-20")).toBe("2026-10-19");
    expect(weekStart("2026-10-25")).toBe("2026-10-19");
    expect(isCivilDate("2026-02-30")).toBe(false);
    expect(isCivilDate("2026-10-20")).toBe(true);
  });
});
