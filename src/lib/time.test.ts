import { describe, expect, it, vi } from "vitest";
import { addDays, dayWindow, deviceZoneDiffers, formatTime, formatWeekdayDay, friendlyZone, isCivilDate, localParts, receivedPeriods, toZonedIso, weekStart, zonedInstant } from "./time.ts";

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

describe("fuso do aparelho e nome amigável (auditoria de UX, item 34)", () => {
  it("só avisa quando o aparelho está noutro horário que o do negócio", () => {
    const at = "2026-10-20T12:00:00Z";
    const spy = vi.spyOn(Date.prototype, "getTimezoneOffset");
    spy.mockReturnValue(180); // aparelho em -03:00, como São Paulo
    expect(deviceZoneDiffers(at, SP)).toBe(false);
    spy.mockReturnValue(-540); // Tóquio
    expect(deviceZoneDiffers(at, SP)).toBe(true);
    spy.mockRestore();
  });

  it("dá nome de gente ao fuso: Brasília, Amazonas; sem nome conhecido, a cidade", () => {
    expect(friendlyZone("2026-10-20T12:00:00Z", SP)).toBe("de Brasília");
    expect(friendlyZone("2026-10-20T12:00:00Z", "America/Manaus")).toBe("do Amazonas");
    expect(friendlyZone("2026-10-20T12:00:00Z", "Etc/GMT+3")).toMatch(/^(d[aeo]s? |do fuso de )/);
  });

  it("visão Semana: \"Seg 19\" curto, sem ponto", () => {
    expect(formatWeekdayDay("2026-10-19")).toBe("Seg 19");
    expect(formatWeekdayDay("2026-10-21")).toBe("Qua 21");
    expect(formatWeekdayDay("2026-11-01")).toBe("Dom 1");
  });
});

describe("receivedPeriods (P48: Hoje · Semana · Mês)", () => {
  it("dia, semana de segunda até o fim de hoje e mês inteiro, no fuso do negócio", () => {
    const p = receivedPeriods("2026-10-20", SP);
    expect(p.day).toEqual({ starts_at: "2026-10-20T00:00:00-03:00", ends_at: "2026-10-21T00:00:00-03:00" });
    expect(p.week).toEqual({ starts_at: "2026-10-19T00:00:00-03:00", ends_at: "2026-10-21T00:00:00-03:00" });
    expect(p.weekFrom).toBe("2026-10-19");
    expect(p.month).toEqual({ starts_at: "2026-10-01T00:00:00-03:00", ends_at: "2026-11-01T00:00:00-03:00" });
  });

  it("semana que começa no mês anterior e virada de ano", () => {
    const p = receivedPeriods("2026-12-31", SP);
    expect(p.week.starts_at).toBe("2026-12-28T00:00:00-03:00");
    expect(p.month.ends_at).toBe("2027-01-01T00:00:00-03:00");
    expect(receivedPeriods("2026-11-01", SP).week.starts_at).toBe("2026-10-26T00:00:00-03:00");
  });
});
