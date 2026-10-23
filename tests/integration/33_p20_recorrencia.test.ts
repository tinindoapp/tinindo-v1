// P20 pelos handlers com o banco real: plano → adesão (termos congelados, 1º ciclo com pacote e recebível) → o
// preço do plano muda e a assinatura não → sessão consumida pelo P07 → ciclo vence e o worker renova uma vez →
// recebível do ciclo pago pelo P14 (simulado) → cancelar ao fim do ciclo / retomar / cancelar agora preserva o saldo.
// SEC: outro dono.
import { afterAll, describe, expect, it } from "vitest";
import { ChargeCreateOutput, FinanceLedgerOutput, RecurrenceCyclesOutput, RecurrenceListOutput, RecurrencePlanListOutput, RecurrencePlanOutput, RecurrenceSubscriptionOutput, SimPayOutput } from "@contracts";
import { fails, FX, iso, ok, pool, runJobs, sql, T, U } from "./harness.ts";

const owner = { as: U.ownerA, tenant: T.A };
afterAll(() => pool.end());
const subs = () => ok(RecurrenceListOutput, "recurrence", "recurrence.subscriptions", { ...owner, body: {} });

describe("P20 · planos recorrentes pelos handlers", () => {
  let planId = "";
  let subId = "";
  let version = 1;

  it("1 · plano criado; adesão congela os termos e abre o 1º ciclo; mudar o plano não altera a assinatura", async () => {
    const p = await ok(RecurrencePlanOutput, "recurrence", "recurrence.plan_save", { ...owner, key: true, body: { service_id: FX.services.corteA, name: "Corte mensal", sessions_per_cycle: 4, price_cents: 20000 } });
    expect(p.plan).toMatchObject({ cycle_days: 30, active: true, subscribers: 0, service_name: "Corte" });
    planId = p.plan.id;
    const s = await ok(RecurrenceSubscriptionOutput, "recurrence", "recurrence.subscribe", { ...owner, key: true, body: { plan_id: planId, customer_id: FX.customers.abInA } });
    expect(s.subscription).toMatchObject({ status: "active", cycles_count: 1, accepted_source: "owner_declared", terms: { price_cents: 20000, sessions_per_cycle: 4, cycle_days: 30 } });
    expect(s.subscription.current_cycle).toMatchObject({ cycle_no: 1, package: { remaining_credits: 4 }, receivable: { amount_cents: 20000, status: "open" } });
    expect(s.subscription.next_renewal_at).toBe(iso(new Date(Date.parse(s.subscription.started_at) + 30 * 86_400_000)));
    subId = s.subscription.id;
    version = s.subscription.version;
    await fails("recurrence", "recurrence.subscribe", { ...owner, key: true, body: { plan_id: planId, customer_id: FX.customers.abInA } }, "POLICY_REJECTED", "subscription");
    const p2 = await ok(RecurrencePlanOutput, "recurrence", "recurrence.plan_save", { ...owner, key: true, body: { plan_id: planId, expected_version: 1, service_id: FX.services.corteA, name: "Corte mensal", sessions_per_cycle: 4, price_cents: 25000 } });
    expect(p2.plan).toMatchObject({ price_cents: 25000, subscribers: 1, version: 2 });
    expect((await subs()).subscriptions.find((x) => x.id === subId)?.terms.price_cents).toBe(20000);
    expect((await ok(RecurrencePlanListOutput, "recurrence", "recurrence.plans", { ...owner, body: {} })).plans.some((x) => x.id === planId)).toBe(true);
  });

  it("2 · o recebível do ciclo é cobrado pelo P14 (simulado) e pago; o ciclo mostra o recebível pago", async () => {
    const cur = (await subs()).subscriptions.find((x) => x.id === subId)!.current_cycle!;
    const c = await ok(ChargeCreateOutput, "payments", "payment.charge_create", { ...owner, key: true, body: { receivable_id: cur.receivable.id, provider: "simulated" } });
    expect(c.charge.status).toBe("pending");
    const token = /#t=([A-Za-z0-9_-]{43})$/.exec(c.pay_url!)![1]!;
    expect(await ok(SimPayOutput, "payments", "payment.sim_pay", { as: null, body: { token } })).toMatchObject({ status: "paid", applied: 1 });
    expect((await subs()).subscriptions.find((x) => x.id === subId)?.current_cycle?.receivable.status).toBe("paid");
    const ledger = await ok(FinanceLedgerOutput, "finance", "finance.ledger", { ...owner, body: { period: { starts_at: iso(new Date(Date.now() - 86_400_000)), ends_at: iso(new Date(Date.now() + 86_400_000)) } } });
    expect(ledger.payments.find((p) => p.receivable_id === cur.receivable.id)?.source).toBe("provider");
  });

  it("3 · o ciclo vence: o worker renova uma vez, com os termos aceitos; o pacote anterior guarda o saldo", async () => {
    expect(((await runJobs()) as { recurrence?: { renewed: number } }).recurrence?.renewed).toBe(0);
    await sql("update public.recurrence_subscriptions set next_renewal_at = clock_timestamp() - interval '1 minute' where id = $1", [subId]);
    expect(((await runJobs()) as { recurrence?: { renewed: number } }).recurrence?.renewed).toBe(1);
    expect(((await runJobs()) as { recurrence?: { renewed: number } }).recurrence?.renewed).toBe(0);
    const s = (await subs()).subscriptions.find((x) => x.id === subId)!;
    expect(s.cycles_count).toBe(2);
    expect(s.current_cycle).toMatchObject({ cycle_no: 2, package: { remaining_credits: 4 }, receivable: { amount_cents: 20000, status: "open" } });
    const cycles = await ok(RecurrenceCyclesOutput, "recurrence", "recurrence.cycles", { ...owner, body: { subscription_id: subId } });
    expect(cycles.cycles.map((c) => c.cycle_no)).toEqual([2, 1]);
    expect(cycles.cycles[1]!.receivable.status).toBe("paid");
    const ev = await sql<{ n: number }>("select count(*)::int as n from public.outbox_events where event_type = 'recurrence.cycle.opened.v1' and aggregate_id = $1", [subId]);
    expect(ev[0]!.n).toBe(2);
    version = s.version;
  });

  it("4 · cancelar ao fim do ciclo (não renova), retomar, cancelar agora preserva o saldo do ciclo corrente", async () => {
    await fails("recurrence", "recurrence.cancel", { ...owner, key: true, body: { subscription_id: subId, expected_version: 1 } }, "STALE_VERSION");
    let s = await ok(RecurrenceSubscriptionOutput, "recurrence", "recurrence.cancel", { ...owner, key: true, body: { subscription_id: subId, expected_version: version, reason: "Mudou de cidade" } });
    expect(s.subscription).toMatchObject({ status: "active", cancel_at_period_end: true, cancel_reason: "Mudou de cidade" });
    s = await ok(RecurrenceSubscriptionOutput, "recurrence", "recurrence.resume", { ...owner, key: true, body: { subscription_id: subId, expected_version: s.subscription.version } });
    expect(s.subscription.cancel_at_period_end).toBe(false);
    s = await ok(RecurrenceSubscriptionOutput, "recurrence", "recurrence.cancel", { ...owner, key: true, body: { subscription_id: subId, expected_version: s.subscription.version, at_period_end: false, reason: null } });
    expect(s.subscription).toMatchObject({ status: "cancelled", cycles_count: 2 });
    expect(s.subscription.current_cycle?.package.remaining_credits).toBe(4);
    expect(Date.parse(s.subscription.current_cycle!.package.expires_at!)).toBeGreaterThan(Date.now());
    await sql("update public.recurrence_subscriptions set next_renewal_at = clock_timestamp() - interval '1 minute' where id = $1", [subId]);
    expect(((await runJobs()) as { recurrence?: { renewed: number; closed: number } }).recurrence).toMatchObject({ renewed: 0, closed: 0 });
    const current = (await subs()).subscriptions.find((x) => x.id === subId)!;
    await fails("recurrence", "recurrence.resume", { ...owner, key: true, body: { subscription_id: subId, expected_version: current.version } }, "POLICY_REJECTED", "status");
  });

  it("SEC · outro dono não vê, não cria plano nem assina", async () => {
    const other = { as: U.ownerB, tenant: T.A };
    await fails("recurrence", "recurrence.subscriptions", { ...other, body: {} }, "FORBIDDEN");
    await fails("recurrence", "recurrence.plan_save", { ...other, key: true, body: { service_id: FX.services.corteA, name: "x", sessions_per_cycle: 1, price_cents: 1 } }, "FORBIDDEN");
    await fails("recurrence", "recurrence.subscribe", { ...other, key: true, body: { plan_id: planId, customer_id: FX.customers.abInA } }, "FORBIDDEN");
    await fails("recurrence", "recurrence.subscribe", { ...owner, key: true, body: { plan_id: planId, customer_id: FX.customers.abInB } }, "NOT_FOUND", "customer_id");
  });
});
