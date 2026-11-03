// P31 pelos handlers com o banco real: categorias próprias → conta a pagar → pagar cria UMA despesa no Caixa (P07) →
// pagar de novo é recusado → estorno uma vez → pagar de novo → conta mensal (12 meses) e encerrar → recebimento manual
// (P07) e pelo PSP simulado (P14) → conciliação por meio e origem → demonstrativo de caixa do mês com cobertura.
// SEC: outro dono, cliente com login, chave obrigatória.
import { afterAll, describe, expect, it } from "vitest";
import { AccCategoryOutput, AccClassifyOutput, AccPayableOutput, AccPayableSaveOutput, AccPayablesOutput, AccReconcileSaveOutput, AccReconciliationOutput,
  AccSeriesUpdateOutput, AccStatementOutput, ChargeCreateOutput, FinanceLedgerOutput, PaymentEntry, ReceivableOutput, SimPayOutput } from "@contracts";
import { call, fails, FX, iso, ok, pool, sql, T, U } from "./harness.ts";

const owner = { as: U.ownerA, tenant: T.A };
afterAll(() => pool.end());
const today = async () => (await sql<{ d: string }>("select to_char((now() at time zone 'America/Sao_Paulo')::date, 'YYYY-MM-DD') as d"))[0]!.d;
const period = () => ({ starts_at: iso(new Date(Date.now() - 86_400_000)), ends_at: iso(new Date(Date.now() + 86_400_000)) });

describe("P31 · financeiro ampliado pelos handlers", () => {
  const id: Record<string, string> = {};
  let day = "";

  it("0 · categorias próprias de despesa e receita", async () => {
    day = await today();
    id.rent = (await ok(AccCategoryOutput, "finance-advanced", "accounts.category_save", { ...owner, key: true,
      body: { kind: "expense", name: "Aluguel do salão (int)", base: "rent" } })).category.id;
    id.course = (await ok(AccCategoryOutput, "finance-advanced", "accounts.category_save", { ...owner, key: true,
      body: { kind: "income", name: "Cursos (int)" } })).category.id;
    await fails("finance-advanced", "accounts.category_save", { ...owner, key: true, body: { kind: "expense", name: "aluguel do salão (int)", base: "rent" } }, "POLICY_REJECTED", "name");
  });

  it("1 · pagar cria uma despesa no Caixa; pagar de novo é recusado; estorno uma vez; pagar de novo depois", async () => {
    const s = await ok(AccPayableSaveOutput, "finance-advanced", "accounts.payable_save", { ...owner, key: true,
      body: { description: "Aluguel (int)", amount_cents: 150000, due_on: day, category_id: id.rent, supplier: "Imobiliária" } });
    expect(s.payable).toMatchObject({ base_category: "rent", status: "open", category_name: "Aluguel do salão (int)" });
    const key = `p31-pagar-${crypto.randomUUID()}`;
    const paid = await ok(AccPayableOutput, "finance-advanced", "accounts.payable_pay", { ...owner, key, body: { payable_id: s.payable.id, expected_version: s.payable.version, paid_at: iso(new Date()) } });
    expect(paid.payable.status).toBe("paid");
    expect((await ok(AccPayableOutput, "finance-advanced", "accounts.payable_pay", { ...owner, key,
      body: { payable_id: s.payable.id, expected_version: s.payable.version, paid_at: iso(new Date()) } })).payable.expense_entry_id).toBe(paid.payable.expense_entry_id);
    await fails("finance-advanced", "accounts.payable_pay", { ...owner, key: true, body: { payable_id: s.payable.id, expected_version: paid.payable.version, paid_at: iso(new Date()) } },
      "POLICY_REJECTED", "paid");
    const ledger = await ok(FinanceLedgerOutput, "finance", "finance.ledger", { ...owner, body: { period: period() } });
    expect(ledger.expenses.filter((e) => e.description === "Aluguel (int)")).toHaveLength(1);
    const rev = await ok(AccPayableOutput, "finance-advanced", "accounts.payable_reverse", { ...owner, key: true, body: { payable_id: s.payable.id, expected_version: paid.payable.version } });
    expect(rev.payable).toMatchObject({ status: "open", reversals: 1 });
    await fails("finance-advanced", "accounts.payable_reverse", { ...owner, key: true, body: { payable_id: s.payable.id, expected_version: rev.payable.version } }, "POLICY_REJECTED", "not_paid");
    const again = await ok(AccPayableOutput, "finance-advanced", "accounts.payable_pay", { ...owner, key: true, body: { payable_id: s.payable.id, expected_version: rev.payable.version, paid_at: iso(new Date()) } });
    expect(again.payable.status).toBe("paid");
    const after = await ok(FinanceLedgerOutput, "finance", "finance.ledger", { ...owner, body: { period: period() } });
    const mine = after.expenses.filter((e) => e.description === "Aluguel (int)");
    expect(mine.filter((e) => e.reversal_of === null)).toHaveLength(2);
    expect(mine.filter((e) => e.reversal_of !== null)).toHaveLength(1);
  });

  it("2 · conta mensal gera 12 meses; encerrar cancela as futuras em aberto", async () => {
    const first = `${day.slice(0, 8)}05`;
    const s = await ok(AccPayableSaveOutput, "finance-advanced", "accounts.payable_save", { ...owner, key: true,
      body: { description: "Internet (int)", amount_cents: 12000, due_on: first, base_category: "utilities", monthly: true } });
    expect(s.created).toBe(12);
    const list = await ok(AccPayablesOutput, "finance-advanced", "accounts.payables", { ...owner, body: { from: first, to: new Date(Date.parse(`${first}T12:00:00Z`) + 370 * 86_400_000).toISOString().slice(0, 10) } });
    expect(list.payables.filter((p) => p.series_id === s.series!.id)).toHaveLength(12);
    const ended = await ok(AccSeriesUpdateOutput, "finance-advanced", "accounts.series_update", { ...owner, key: true,
      body: { series_id: s.series!.id, expected_version: s.series!.version, action: "end" } });
    expect(ended.series.active).toBe(false);
    expect(ended.affected).toBeGreaterThanOrEqual(11);
  });

  it("3 · recebimento manual (P07) e pelo PSP simulado (P14); conciliação por meio e origem", async () => {
    const rec = await ok(ReceivableOutput, "finance", "finance.create_receivable", { ...owner, key: true, body: { customer_id: FX.customers.abInA, description: "Curso de barba (int)", amount_cents: 30000 } });
    const pay = await ok(PaymentEntry, "finance", "finance.record_payment", { ...owner, key: true, body: { receivable_id: rec.receivable.id, amount_cents: 30000, method: "pix", received_at: iso(new Date()) } });
    await ok(AccClassifyOutput, "finance-advanced", "accounts.classify", { ...owner, key: true, body: { entry_kind: "payment", entry_id: pay.id, category_id: id.course } });
    await fails("finance-advanced", "accounts.classify", { ...owner, key: true, body: { entry_kind: "payment", entry_id: pay.id, category_id: id.rent } }, "NOT_FOUND", "category_id");
    const rec2 = await ok(ReceivableOutput, "finance", "finance.create_receivable", { ...owner, key: true, body: { customer_id: FX.customers.abInA, description: "Corte pelo Pix (int)", amount_cents: 7000 } });
    const charge = await ok(ChargeCreateOutput, "payments", "payment.charge_create", { ...owner, key: true, body: { receivable_id: rec2.receivable.id, provider: "simulated" } });
    const token = /#t=([A-Za-z0-9_-]{43})$/.exec(charge.pay_url!)![1]!;
    expect(await ok(SimPayOutput, "payments", "payment.sim_pay", { as: null, body: { token } })).toMatchObject({ status: "paid" });

    const r = await ok(AccReconciliationOutput, "finance-advanced", "accounts.reconciliation", { ...owner, body: { day } });
    const manual = r.rows.find((x) => x.method === "pix" && x.source === "manual")!;
    const psp = r.rows.find((x) => x.source === "provider")!;
    expect(manual.ledger_cents).toBeGreaterThanOrEqual(30000);
    expect(psp.ledger_cents).toBeGreaterThanOrEqual(7000);
    // O provedor diz o que pagou no dia (outras cobranças do banco de teste também entram): pelo menos esta.
    expect(psp.partner_paid_cents).toBeGreaterThanOrEqual(7000);
    const saved = await ok(AccReconcileSaveOutput, "finance-advanced", "accounts.reconcile_save", { ...owner, key: true,
      body: { day, method: "pix", source: "manual", statement_cents: manual.ledger_cents - 500 } });
    expect(saved.reconciliation.difference_cents).toBe(-500);
    await fails("finance-advanced", "accounts.reconcile_save", { ...owner, key: true, body: { day: "2999-01-01", method: "pix", source: "manual", statement_cents: 1 } }, "VALIDATION_ERROR", "day");
  });

  it("4 · demonstrativo de caixa do mês: período escrito, categorias, sobrou e cobertura; não é DRE", async () => {
    const st = await ok(AccStatementOutput, "finance-advanced", "accounts.statement", { ...owner, body: { month: day.slice(0, 7) } });
    expect(st.basis).toBe("cash");
    expect(st.period).toMatchObject({ month: day.slice(0, 7), first_day: `${day.slice(0, 7)}-01`, timezone: "America/Sao_Paulo" });
    expect(st.net_cents).toBe(st.in_cents - st.out_cents);
    expect(st.income.find((l) => l.label === "Cursos (int)")?.cents).toBe(30000);
    // O aluguel conta duas vezes como pago (a segunda depois do estorno); o estornado não conta.
    expect(st.expenses.find((l) => l.label === "Aluguel do salão (int)")?.cents).toBe(150000);
    expect(st.coverage.days_unreconciled).toBeGreaterThanOrEqual(1);
    expect(st.note).toMatch(/Não é DRE/);
  });

  it("SEC · outro dono e cliente com login não leem nem pagam; comando sem chave é recusado", async () => {
    await fails("finance-advanced", "accounts.statement", { as: U.ownerB, tenant: T.A, body: { month: day.slice(0, 7) } }, "FORBIDDEN");
    await fails("finance-advanced", "accounts.payables", { as: U.customerAB, tenant: T.A, body: { from: day, to: day } }, "FORBIDDEN");
    const noKey = await call("finance-advanced", "accounts.payable_save", { ...owner, body: { description: "x", amount_cents: 1, due_on: day } });
    expect(noKey.error?.field).toBe("idempotency_key");
    const [{ pid }] = await sql<{ pid: string }>("select id as pid from public.fin_payables where description = 'Aluguel (int)'");
    await fails("finance-advanced", "accounts.payable_pay", { as: U.ownerB, tenant: T.B, key: true, body: { payable_id: pid, expected_version: 9, paid_at: iso(new Date()) } }, "NOT_FOUND");
  });
});
