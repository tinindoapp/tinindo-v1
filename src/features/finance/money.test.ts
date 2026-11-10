import { describe, expect, it } from "vitest";
import { FinancePeriodInput } from "@contracts";
import { capitalizeFirst, endOfLocalDay, formatMonth, leftover, monthPeriod, newestFirst, noonOfLocalDay, pendingPeriod, shiftMonth, startOfLocalDay, unchargedTotal } from "./money.ts";

// A leitura e a formatação de dinheiro são testadas em src/lib/money.test.ts.
describe("datas e contas do caixa", () => {
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

  it("pendências: um ano até o fim de hoje, no fuso do negócio, dentro do que o contrato aceita", () => {
    const p = pendingPeriod("2026-10-20", "America/Sao_Paulo");
    expect(p).toEqual({ starts_at: "2025-10-20T03:00:00.000Z", ends_at: "2026-10-21T03:00:00.000Z" });
    expect(FinancePeriodInput.safeParse({ period: p }).success).toBe(true);
    // 29/02 → 28/02 do ano anterior; o período nunca passa de 400 dias (limite de app.fin_period no banco).
    const leap = pendingPeriod("2028-02-29", "America/Sao_Paulo");
    expect(leap.starts_at).toBe("2027-02-28T03:00:00.000Z");
    expect((Date.parse(leap.ends_at) - Date.parse(leap.starts_at)) / 86_400_000).toBeLessThanOrEqual(400);
    expect(newestFirst([{ starts_at: "2026-09-28T12:00:00Z" }, { starts_at: "2026-10-19T14:00:00-03:00" }])[0]!.starts_at).toBe("2026-10-19T14:00:00-03:00");
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
