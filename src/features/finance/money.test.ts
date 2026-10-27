import { describe, expect, it } from "vitest";
import { capitalizeFirst, endOfLocalDay, formatCents, formatMonth, leftover, monthPeriod, noonOfLocalDay, parseBRL, shiftMonth, startOfLocalDay, unchargedTotal } from "./money.ts";

describe("dinheiro e datas do caixa", () => {
  it("lê reais em centavos inteiros, sem float", () => {
    expect(parseBRL("60")).toBe(6000);
    expect(parseBRL("60,5")).toBe(6050);
    expect(parseBRL("1.234,56")).toBe(123456);
    expect(parseBRL("R$ 0,10")).toBe(10);
    expect(parseBRL("")).toBeNull();
    expect(parseBRL("12,345")).toBeUndefined();
    expect(parseBRL("-5")).toBeUndefined();
    expect(formatCents(123456)).toMatch(/1\.234,56/);
  });

  it("mês e dia seguem o fuso do negócio, não o do navegador", () => {
    expect(startOfLocalDay("2026-10-20", "America/Sao_Paulo")).toBe("2026-10-20T03:00:00.000Z");
    expect(noonOfLocalDay("2026-10-20", "America/Sao_Paulo")).toBe("2026-10-20T15:00:00.000Z");
    expect(endOfLocalDay("2026-10-31", "America/Sao_Paulo")).toBe("2026-11-01T02:59:59.000Z");
    expect(monthPeriod("2026-12", "America/Sao_Paulo")).toEqual({
      starts_at: "2026-12-01T03:00:00.000Z",
      ends_at: "2027-01-01T03:00:00.000Z",
    });
    // Horário de verão (Nova York): o mês de março começa às 05:00Z e abril às 04:00Z.
    expect(monthPeriod("2026-03", "America/New_York")).toEqual({
      starts_at: "2026-03-01T05:00:00.000Z",
      ends_at: "2026-04-01T04:00:00.000Z",
    });
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
  });

  it("sobrou no mês = recebido − gasto; negativo vira 'Faltou'", () => {
    expect(leftover(26000, 1500)).toEqual({ cents: 24500, label: "Sobrou no mês" });
    expect(leftover(0, 0)).toEqual({ cents: 0, label: "Sobrou no mês" });
    expect(leftover(1000, 3000)).toEqual({ cents: -2000, label: "Faltou no mês" });
    expect(unchargedTotal([{ agreed_price_cents: 6000 }, { agreed_price_cents: 4000 }, { agreed_price_cents: null }])).toBe(10000);
    expect(unchargedTotal([])).toBe(0);
  });

  it("mês com só a primeira letra maiúscula", () => {
    expect(formatMonth("2026-10")).toBe("outubro de 2026");
    expect(capitalizeFirst(formatMonth("2026-10"))).toBe("Outubro de 2026");
    expect(capitalizeFirst("")).toBe("");
  });
});
