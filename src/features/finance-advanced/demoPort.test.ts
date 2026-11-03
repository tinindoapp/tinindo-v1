import { beforeEach, describe, expect, it } from "vitest";
import { createDemoPort, resetDemoState } from "./demoPort.ts";

const code = (p: Promise<unknown>) => p.then(() => "ok", (e: { code: string; field?: string }) => `${e.code}/${e.field ?? "-"}`);

describe("demonstração de Contas (mesmas regras do banco)", () => {
  beforeEach(() => resetDemoState());

  it("pagar lança uma despesa; pagar de novo é recusado; estorno uma vez; pagar de novo depois", async () => {
    const port = createDemoPort();
    const { payables } = await port.payables("2026-10-01", "2026-12-31");
    const luz = payables.find((p) => p.description === "Conta de luz")!;
    const before = (await port.statement("2026-10")).out_cents;
    const paid = await port.pay(luz, "2026-10-20T12:00:00Z", "k1");
    expect(paid.status).toBe("paid");
    expect((await port.pay(luz, "2026-10-20T12:00:00Z", "k1")).expense_entry_id).toBe(paid.expense_entry_id);
    expect(await code(port.pay(paid, "2026-10-20T12:00:00Z", "k2"))).toBe("POLICY_REJECTED/paid");
    expect(await code(port.pay(luz, "2026-10-20T12:00:00Z", "k3"))).toBe("STALE_VERSION/-");
    expect((await port.statement("2026-10")).out_cents).toBe(before + 18000);
    const rev = await port.reverse(paid, "r1");
    expect(rev).toMatchObject({ status: "open", reversals: 1 });
    expect(await code(port.reverse(rev, "r2"))).toBe("POLICY_REJECTED/not_paid");
    expect((await port.statement("2026-10")).out_cents).toBe(before);
    expect((await port.pay(rev, "2026-10-20T12:00:00Z", "k4")).status).toBe("paid");
  });

  it("mensal cria 12 contas, vence até o dia 28; encerrar cancela as futuras", async () => {
    const port = createDemoPort();
    expect(await code(port.savePayable({ description: "Luz", amount_cents: 9000, due_on: "2026-10-30", monthly: true }, "m0"))).toBe("VALIDATION_ERROR/due_on");
    const r = await port.savePayable({ description: "Contador", amount_cents: 25000, due_on: "2026-10-20", monthly: true, base_category: "fees" }, "m1");
    expect(r.created).toBe(12);
    const { series } = await port.payables("2026-10-01", "2027-12-31");
    const s = series.find((x) => x.description === "Contador")!;
    const ended = await port.updateSeries(s, "end", "e1");
    expect(ended.series.active).toBe(false);
    expect(ended.affected).toBe(12);
    expect(await code(port.updateSeries(ended.series, "extend", "e2"))).toBe("POLICY_REJECTED/status");
  });

  it("demonstrativo de caixa: período, categorias próprias, sobrou e cobertura; conciliação guarda a diferença", async () => {
    const port = createDemoPort();
    const cat = await port.saveCategory({ kind: "income", name: "Planos mensais" }, "c1");
    expect(await code(port.saveCategory({ kind: "income", name: "planos mensais" }, "c2"))).toBe("POLICY_REJECTED/name");
    const entries = await port.entries("2026-10");
    const plan = entries.find((e) => e.base === "packages")!;
    await port.classify(plan, cat.id, "cl1");
    const st = await port.statement("2026-10");
    expect(st).toMatchObject({ basis: "cash", in_cents: 30000, period: { first_day: "2026-10-01", last_day: "2026-10-31", timezone: "America/Sao_Paulo" } });
    expect(st.net_cents).toBe(st.in_cents - st.out_cents);
    expect(st.income.find((l) => l.label === "Planos mensais")?.cents).toBe(20000);
    expect(st.note).toMatch(/Não é DRE/);
    expect(st.coverage.days_unreconciled).toBe(2);
    const rows = await port.reconciliation("2026-10-14");
    expect(rows.map((r) => `${r.source}:${r.method}:${r.ledger_cents}`)).toEqual(["manual:cash:4000", "manual:pix:6000"]);
    expect(await port.reconcile("2026-10-14", "pix", "manual", 5500, "rc1")).toBe(-500);
    expect(await code(port.reconcile("2026-10-30", "pix", "manual", 1, "rc2"))).toBe("VALIDATION_ERROR/day");
  });
});
