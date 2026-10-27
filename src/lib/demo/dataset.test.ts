// Item 47 da auditoria de UX: a demonstração mostra os MESMOS números em todas as telas de dinheiro e de resultado,
// porque todas leem a base de exemplo única (dataset.ts). Este teste confere os portos lado a lado.
import { describe, expect, it } from "vitest";
import { createDemoPort as analyticsPort, resetDemoState as resetAnalytics } from "../../features/analytics/demoPort.ts";
import { createDemoPort as financePort } from "../../features/finance/demoPort.ts";
import { createDemoPort as goalsPort, resetDemoState as resetGoals } from "../../features/growth-advice/demoPort.ts";
import { createDemoPort as paymentsPort, resetDemoState as resetPayments } from "../../features/payments/demoPort.ts";
import { DEMO_OPEN_RECEIVABLES, DEMO_TZ, demoCounts, demoMonthToDate, demoUncharged } from "./dataset.ts";

const month = demoMonthToDate();
const metric = (list: { key: string; value: number | null; numerator: number | null; denominator: number | null }[], key: string) =>
  list.find((m) => m.key === key)!;

describe("base de exemplo única", () => {
  it("mês até ontem: Caixa, Resultado e Metas mostram o mesmo recebido, gasto, faltas e cobertura", async () => {
    resetAnalytics();
    resetGoals();
    const caixa = await financePort().summary(month, DEMO_TZ);
    const resultado = (await analyticsPort().metrics(month, null)).metrics;
    const metas = (await goalsPort().goals()).metrics;
    const c = demoCounts(month);

    expect(caixa.received_cents).toBe(c.received);
    expect(metric(resultado, "received").value).toBe(c.received);
    expect(metric(metas, "received").value).toBe(c.received);

    expect(caixa.spent_cents).toBe(c.spent);
    expect(metric(resultado, "expenses").value).toBe(c.spent);
    expect(metric(metas, "expenses").value).toBe(c.spent);

    for (const key of ["no_show", "occupancy", "charge_coverage", "reminders", "cancellation"]) {
      expect(metric(metas, key), key).toEqual(metric(resultado, key));
    }
    expect(metric(resultado, "charge_coverage").denominator! - metric(resultado, "charge_coverage").numerator!)
      .toBe(demoUncharged().filter((v) => Date.parse(v.starts_at) >= Date.parse(month.starts_at)).length);
  });

  it("A receber: o Caixa e Pagamentos listam os mesmos valores em aberto", async () => {
    resetPayments();
    const open = DEMO_OPEN_RECEIVABLES.reduce((s, r) => s + r.amount_cents, 0);
    expect((await financePort().summary(month, DEMO_TZ)).receivable_open_cents).toBe(open);
    const list = await paymentsPort().openReceivables();
    expect(list.reduce((s, r) => s + r.open_cents, 0)).toBe(open);
  });

  it("a mesma conta vale para qualquer período (7 e 28 dias)", async () => {
    resetAnalytics();
    for (const days of [7, 28]) {
      const p = { starts_at: new Date(Date.parse(month.ends_at) - days * 86_400_000).toISOString(), ends_at: month.ends_at };
      const r = (await analyticsPort().metrics(p, null)).metrics;
      expect(metric(r, "received").value, `${days} dias`).toBe(demoCounts(p).received);
      expect((await financePort().summary(p, DEMO_TZ)).received_cents, `${days} dias`).toBe(demoCounts(p).received);
    }
  });
});
