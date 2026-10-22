// P14 pelos handlers com o banco real e o PSP simulado: cobrança pelo saldo do recebível, link público, o cliente
// paga (webhook assinado pelo caminho de sim_pay), baixa única no caixa com origem no provedor, estorno vinculado,
// webhook perdido → conciliação lista → sync resolve, criação sem resposta → desconhecido → consulta, cancelar e
// expirar. SEC: outro dono, webhook forjado, token errado, PSP real sem credenciais.
import { afterAll, describe, expect, it } from "vitest";
import { ChargeCreateOutput, ChargeOutput, ChargesListOutput, FinanceLedgerOutput, PaymentLinkView, ReceivableOutput, ReconcileOutput, ReconciliationsListOutput, RefundOutput, SimPayOutput } from "@contracts";
import { call, fails, FX, handlers, iso, ok, pool, runPaymentSync, sql, T, U } from "./harness.ts";

const owner = { as: U.ownerA, tenant: T.A };
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
afterAll(() => pool.end());

async function receivable(amount: number, description: string) {
  const r = await ok(ReceivableOutput, "finance", "finance.create_receivable", { ...owner, key: true, body: { customer_id: FX.customers.abInA, description, amount_cents: amount } });
  return r.receivable;
}
const charge = (receivable_id: string, key: string | true = true) =>
  ok(ChargeCreateOutput, "payments", "payment.charge_create", { ...owner, key, body: { receivable_id, provider: "simulated" } });
const tokenOf = (payUrl: string | null) => /#t=([A-Za-z0-9_-]{43})$/.exec(payUrl!)![1]!;
const view = (token: string) => ok(PaymentLinkView, "payments", "payment.link_view", { as: null, body: { token } });
const simPay = (token: string, extra: Record<string, unknown> = {}) => ok(SimPayOutput, "payments", "payment.sim_pay", { as: null, body: { token, ...extra } });
const list = () => ok(ChargesListOutput, "payments", "payment.charges", { ...owner, body: {} });
const ledger = async () => ok(FinanceLedgerOutput, "finance", "finance.ledger", { ...owner, body: { period: { starts_at: iso(new Date(Date.now() - 86_400_000)), ends_at: iso(new Date(Date.now() + 86_400_000)) } } });

describe("P14 · pagamento conectado (PSP simulado)", () => {
  let token = "";
  let chargeId = "";
  let receivableId = "";

  it("1 · cobrança pelo saldo: pendente no provedor, Pix e link; repetir devolve a mesma; uma viva por recebível", async () => {
    const r = await receivable(6000, "Corte");
    receivableId = r.id;
    const c = await charge(r.id, "chave-cobranca-corte-0001");
    expect(c.charge).toMatchObject({ status: "pending", amount_cents: 6000, simulated: true, provider: "simulated" });
    expect(c.charge.external_id).toMatch(/^sim-/);
    expect(c.charge.pix_code).toContain("SIMULADO");
    expect(c.pay_url).toMatch(/\/pagar#t=[A-Za-z0-9_-]{43}$/);
    token = tokenOf(c.pay_url);
    chargeId = c.charge.id;
    const again = await charge(r.id, "chave-cobranca-corte-0001");
    expect(again.charge).toMatchObject({ id: chargeId, status: "pending", external_id: c.charge.external_id });
    expect(tokenOf(again.pay_url)).toBe(token);
    await fails("payments", "payment.charge_create", { ...owner, key: true, body: { receivable_id: r.id, provider: "simulated" } }, "POLICY_REJECTED", "charge");
    await fails("payments", "payment.charge_create", { ...owner, key: true, body: { receivable_id: r.id, provider: "psp" } }, "PROVIDER_UNAVAILABLE");
  });

  it("2 · link público mostra a cobrança; token errado não existe", async () => {
    const v = await view(token);
    expect(v).toMatchObject({ charge_id: chargeId, status: "pending", amount_cents: 6000, description: "Corte", simulated: true });
    expect(v.business_name.length).toBeGreaterThan(0);
    await fails("payments", "payment.link_view", { as: null, body: { token: "a".repeat(43) } }, "NOT_FOUND");
    await fails("payments", "payment.link_view", { as: null, body: { token: "curto" } }, "NOT_FOUND");
  });

  it("3 · o cliente paga: webhook assinado → UMA baixa com origem no provedor; pagar de novo não dobra", async () => {
    expect(await simPay(token)).toEqual({ status: "paid", applied: 1, duplicates: 0 });
    expect(await simPay(token)).toEqual({ status: "paid", applied: 0, duplicates: 0 });
    expect((await view(token)).status).toBe("paid");
    const l = await ledger();
    const paid = l.payments.filter((p) => p.receivable_id === receivableId);
    expect(paid).toHaveLength(1);
    expect(paid[0]).toMatchObject({ source: "provider", method: "pix", amount_cents: 6000 });
    expect(l.receivables.find((x) => x.id === receivableId)?.status).toBe("paid");
    const c = (await list()).charges.find((x) => x.id === chargeId)!;
    expect(c).toMatchObject({ status: "paid", settlement: "entry", paid_cents: 6000 });
    expect(c.payment_entry_id).toBe(paid[0]!.id);
    const ev = await sql<{ n: number }>("select count(*)::int as n from public.outbox_events where event_type = 'payment.recorded.v1' and payload->>'charge_id' = $1", [chargeId]);
    expect(ev[0]!.n).toBe(1);
  });

  it("4 · estorno total: pedido pelo dono, confirmado pelo PSP, vira reversão vinculada; não repete", async () => {
    const f = await ok(RefundOutput, "payments", "payment.refund", { ...owner, key: true, body: { charge_id: chargeId, reason: "Cliente desistiu" } });
    expect(f.refund).toMatchObject({ status: "done", amount_cents: 6000 });
    expect(f.refund.reversal_entry_id).toBeTruthy();
    const l = await ledger();
    expect(l.payments.filter((p) => p.receivable_id === receivableId && p.reversal_of)).toHaveLength(1);
    expect(l.receivables.find((x) => x.id === receivableId)?.status).toBe("open");
    await fails("payments", "payment.refund", { ...owner, key: true, body: { charge_id: chargeId, reason: "de novo" } }, "POLICY_REJECTED");
    expect((await list()).charges.find((x) => x.id === chargeId)?.refund_status).toBe("done");
  });

  it("5 · webhook perdido: o banco continua pendente; a conciliação lista a diferença; o sync consulta e dá baixa", async () => {
    const r = await receivable(4000, "Barba");
    const c = await charge(r.id);
    const t = tokenOf(c.pay_url);
    expect(await simPay(t, { notify: false })).toEqual({ status: "pending", applied: 0, duplicates: 0 });
    expect((await view(t)).status).toBe("pending");
    const rec = await ok(ReconcileOutput, "payments", "payment.reconcile", { ...owner, key: true, body: { provider: "simulated", day: today() } });
    expect(rec.reconciliation.differences).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "paid_without_entry", charge_id: c.charge.id })]));
    expect(rec.reconciliation.report_paid_cents).toBe(4000); // só a barba: o corte foi estornado no PSP
    // Ainda não venceu: o sync não mexe. Vencida há mais de 1 min: consulta → o PSP diz pago → baixa.
    expect(await runPaymentSync()).toMatchObject({ checked: 0 });
    await sql("update public.payment_charges set expires_at = clock_timestamp() - interval '2 minutes' where id = $1", [c.charge.id]);
    expect(await runPaymentSync()).toMatchObject({ checked: 1, settled: 1 });
    expect((await list()).charges.find((x) => x.id === c.charge.id)).toMatchObject({ status: "paid", settlement: "entry" });
    const after = await ok(ReconcileOutput, "payments", "payment.reconcile", { ...owner, key: true, body: { provider: "simulated", day: today() } });
    expect(after.reconciliation.differences).toEqual([]);
    expect(after.reconciliation.ledger_paid_cents).toBe(4000);
    expect((await ok(ReconciliationsListOutput, "payments", "payment.reconciliations", { ...owner, body: {} })).reconciliations[0]?.id).toBe(after.reconciliation.id);
  });

  it("6 · provedor sem resposta: desconhecido, não presumido; a consulta fecha; valor recusado falha na hora", async () => {
    const r = await receivable(3098, "Produto");
    const c = await charge(r.id);
    expect(c.charge.status).toBe("unknown");
    expect(c.charge.external_id).toBeNull();
    expect((await list()).unknown).toBe(1);
    await sql("update public.payment_charges set unknown_since = clock_timestamp() - interval '2 minutes' where id = $1", [c.charge.id]);
    expect(await runPaymentSync()).toMatchObject({ checked: 1, closed: 1 });
    expect((await list()).charges.find((x) => x.id === c.charge.id)?.status).toBe("failed");
    // A cobrança falha não está viva: dá para tentar de novo (segunda tentativa do simulado responde).
    const retry = await charge(r.id);
    expect(retry.charge.status).toBe("pending");
    const bad = await receivable(1099, "Taxa");
    expect((await charge(bad.id)).charge).toMatchObject({ status: "failed", failure_reason: "amount_rejected" });
  });

  it("7 · cancelar exige a versão vista; cobrança cancelada não aceita pagamento pelo link; expirar pelo PSP", async () => {
    const r = await receivable(2000, "Sobrancelha");
    const c = await charge(r.id);
    await fails("payments", "payment.charge_cancel", { ...owner, key: true, body: { charge_id: c.charge.id, expected_version: 1 } }, "STALE_VERSION");
    const x = await ok(ChargeOutput, "payments", "payment.charge_cancel", { ...owner, key: true, body: { charge_id: c.charge.id, expected_version: c.charge.version } });
    expect(x.charge.status).toBe("cancelled");
    expect(await simPay(tokenOf(c.pay_url))).toEqual({ status: "cancelled", applied: 0, duplicates: 0 });
    const r2 = await receivable(2500, "Pé");
    const c2 = await charge(r2.id);
    expect(await simPay(tokenOf(c2.pay_url), { outcome: "expired" })).toEqual({ status: "expired", applied: 1, duplicates: 0 });
    expect((await view(tokenOf(c2.pay_url))).status).toBe("expired");
  });

  it("SEC · outro dono não vê nem cobra; webhook forjado não entra; PSP real sem credenciais não cria nada", async () => {
    const other = { as: U.ownerB, tenant: T.A };
    await fails("payments", "payment.charges", { ...other, body: {} }, "FORBIDDEN");
    await fails("payments", "payment.charge_create", { ...other, key: true, body: { receivable_id: receivableId, provider: "simulated" } }, "FORBIDDEN");
    await fails("payments", "payment.refund", { ...other, key: true, body: { charge_id: chargeId, reason: "x" } }, "FORBIDDEN");
    await fails("payments", "payment.reconcile", { ...other, key: true, body: { provider: "simulated", day: today() } }, "FORBIDDEN");
    const raw = JSON.stringify({ events: [{ external_event_id: "forjado-1", kind: "charge.paid", external_id: "sim-x", amount_cents: 1 }] });
    const res = await handlers.payments!(new Request("http://edge/functions/v1/payments/payment.webhook/simulated", { method: "POST", body: raw, headers: { "X-Hub-Signature-256": "sha256=" + "0".repeat(64) } }));
    expect(res.status).toBe(401);
    expect((await sql<{ n: number }>("select count(*)::int as n from public.payment_webhook_events where external_event_id = 'forjado-1'"))[0]!.n).toBe(0);
    const wrongSecret = await handlers.payments!(new Request("http://edge/functions/v1/payments/payment.sync", { method: "POST", headers: { "X-Tinindo-Sync-Secret": "x".repeat(40) } }));
    expect(wrongSecret.status).toBe(401);
    const r = await call("payments", "payment.sim_pay", { as: null, body: { token: "b".repeat(43) } });
    expect(r.error?.code).toBe("NOT_FOUND");
  });
});
