import { describe, expect, it, vi } from "vitest";
import {
  addDays, dayWindow, deviceTimeZone, deviceZoneDiffers, endOfLocalDay, formatCivilDate, formatDate, formatDateTime, formatDayMonth, formatFullDateTime, formatMonth, formatSlot,
  formatStart, formatTime, formatWeekdayDate, formatWeekdayDateTime, formatWeekdayDay, formatWeekdayDayMonth, formatWeekdayLongDate, friendlyZone, isCivilDate,
  localDate, localParts, localToIso, noonOfLocalDay, now, receivedPeriods, setClockForTest, startOfLocalDay, startOfNextLocalDay, today,
  toZonedIso, weekStart, zonedInstant,
} from "./time.ts";

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
  it("fuso do aparelho é o que o Intl usa quando a tela não diz o fuso", () => {
    const at = new Date("2026-10-21T03:30:00Z");
    const plain = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(at);
    expect(formatTime(at, deviceTimeZone())).toBe(plain);
  });

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

describe("relógio e formatos comuns das telas", () => {
  const MANAUS = "America/Manaus";
  // 03:30Z = 00:30 em São Paulo (dia 21) e 23:30 em Manaus (dia 20).
  const instant = "2026-10-21T03:30:00.000Z";

  it("now() usa o relógio trocado no teste e volta ao real", () => {
    const restore = setClockForTest(() => new Date(instant));
    expect(now().toISOString()).toBe(instant);
    expect(today(SP)).toBe("2026-10-21");
    expect(today(MANAUS)).toBe("2026-10-20");
    restore();
    expect(Math.abs(now().getTime() - Date.now())).toBeLessThan(5_000);
  });

  it("limites do dia civil no fuso do negócio, em UTC", () => {
    expect(localDate(instant, SP)).toBe("2026-10-21");
    expect(startOfLocalDay("2026-10-20", SP)).toBe("2026-10-20T03:00:00.000Z");
    expect(startOfNextLocalDay("2026-10-20", SP)).toBe("2026-10-21T03:00:00.000Z");
    expect(noonOfLocalDay("2026-10-20", SP)).toBe("2026-10-20T15:00:00.000Z");
    expect(endOfLocalDay("2026-10-20", SP)).toBe("2026-10-21T02:59:59.000Z");
    expect(endOfLocalDay("2026-10-20", MANAUS)).toBe("2026-10-21T03:59:59.000Z");
    expect(localToIso("2026-10-20", "09:30", SP)).toBe("2026-10-20T12:30:00.000Z");
  });

  it("formatos saem iguais aos que os módulos montavam à mão com Intl", () => {
    const d = new Date(instant);
    const raw = (o: Intl.DateTimeFormatOptions, tz = SP) => new Intl.DateTimeFormat("pt-BR", { timeZone: tz, ...o }).format(d);
    expect(formatDate(instant, SP)).toBe(raw({ day: "2-digit", month: "2-digit", year: "numeric" }));
    expect(formatDate(instant, SP)).toBe("21/10/2026");
    expect(formatDate(instant, MANAUS)).toBe("20/10/2026");
    expect(formatDayMonth(instant, SP)).toBe("21/10");
    expect(formatDateTime(instant, SP)).toBe(raw({ day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }));
    expect(formatWeekdayDate(instant, SP)).toBe(raw({ weekday: "short", day: "2-digit", month: "2-digit" }));
    expect(formatWeekdayDateTime(instant, SP)).toBe(raw({ weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }));
    expect(formatWeekdayLongDate(instant, SP)).toBe("quarta-feira, 21/10");
    // Meia-noite e meia: a hora sai "00:30" com ou sem hourCycle explícito.
    expect(formatTime(instant, SP)).toBe(raw({ hour: "2-digit", minute: "2-digit" }));
    expect(formatTime(instant, SP)).toBe("00:30");
    expect(formatSlot({ starts_at: instant, ends_at: "2026-10-21T04:00:00.000Z" }, SP)).toBe("quarta-feira, 21/10, 00:30–01:00");
    expect(formatStart(instant, SP)).toBe("quarta-feira, 21/10, às 00:30");
    expect(formatCivilDate("2026-10-20")).toBe("20/10/2026");
    expect(formatMonth("2026-10")).toBe("outubro de 2026");
    expect(formatMonth("2026-10-31")).toBe("outubro de 2026");
  });

  it("data com ano e hora, e chip de dia (P53: Perfil, Site, Pagamentos)", () => {
    const d = new Date(instant);
    expect(formatFullDateTime(instant, SP)).toBe(new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: SP }).format(d));
    expect(formatFullDateTime(instant, SP)).toBe("21/10/2026, 00:30");
    expect(formatFullDateTime(instant, MANAUS)).toBe("20/10/2026, 23:30");
    expect(formatWeekdayDayMonth("2026-10-20")).toBe("ter 20/10");
    expect(formatWeekdayDayMonth("2026-10-25")).toBe("dom 25/10");
    // Igual ao que o Perfil montava à mão, em todos os dias de um ano (meio-dia UTC, sem fuso do aparelho).
    for (let day = "2026-01-01"; day < "2027-01-01"; day = addDays(day, 1)) {
      const weekday = new Intl.DateTimeFormat("pt-BR", { weekday: "short", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`)).replace(".", "");
      expect(formatWeekdayDayMonth(day)).toBe(`${weekday} ${day.slice(8, 10)}/${day.slice(5, 7)}`);
    }
  });
});
