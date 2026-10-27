// P28 pelos handlers com o banco real: equipe (profissionais, sala, cadeira) → reserva composta → o conflito de um
// recurso recusa a reserva inteira sem prender os outros → a agenda individual do dono e a equipe não se sobrepõem
// (nos dois sentidos) → concluir cria o recebível no Caixa (P07) e a comissão uma vez → pagamento registrado no Caixa →
// turma com lotação → relatório e estorno de comissão. SEC: outro dono, cliente com login, chave obrigatória.
import { afterAll, describe, expect, it } from "vitest";
import { BookingOutput, FinanceLedgerOutput, PaymentEntry, TeamAvailabilityOutput, TeamBookingOutput, TeamClassOutput, TeamCommissionEntryOutput,
  TeamCommissionRulesOutput, TeamCommissionsOutput, TeamListOutput, TeamResourceOutput, TeamScheduleOutput } from "@contracts";
import { call, fails, FX, iso, newKey, nextWeek, ok, plusMin, pool, rpc, sql, T, U } from "./harness.ts";

const owner = { as: U.ownerA, tenant: T.A };
afterAll(() => pool.end());
/** Segunda daqui a 7 semanas: longe das datas que os outros roteiros usam. */
const day = async (hhmm: string) => iso(new Date(Date.parse(await nextWeek(1, hhmm)) + 42 * 86_400_000));

describe("P28 · equipes e recursos pelos handlers", () => {
  const id: Record<string, string> = {};
  let t10 = "";
  let bookingId = "";

  it("0 · horário de funcionamento e equipe: duas profissionais, sala e cadeira; comissão por serviço", async () => {
    const rules = [1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, local_start: "09:00", local_end: "19:00" }));
    const [{ version }] = await sql<{ version: number }>("select version from public.resources where id = $1", [FX.resources.A]);
    expect((await rpc(U.ownerA, "scheduling_rules_save", { p_tenant_id: T.A, p_resource_id: FX.resources.A, p_expected_version: version,
      p_rules: rules, p_idem_key: newKey(), p_request_hash: "a".repeat(64) })).error).toBeNull();
    const save = async (k: string, body: object) => { id[k] = (await ok(TeamResourceOutput, "resources", "resources.save", { ...owner, key: true, body })).resource.id; };
    await save("bia", { kind: "professional", name: "Bia (equipe)", commission_bps: 4000 });
    await save("caio", { kind: "professional", name: "Caio (equipe)", agenda_linked: true });
    await save("sala", { kind: "room", name: "Sala de coloração" });
    await save("cadeira", { kind: "chair", name: "Cadeira 3" });
    await fails("resources", "resources.save", { ...owner, key: true, body: { kind: "chair", name: "Cadeira 4", commission_bps: 100 } }, "VALIDATION_ERROR", "commission_bps");
    const rules2 = await ok(TeamCommissionRulesOutput, "resources", "resources.commission_rule_save", { ...owner, key: true,
      body: { professional_id: id.bia, service_id: FX.services.corteA, bps: 5000 } });
    expect(rules2.commission_rules).toContainEqual({ professional_id: id.bia, service_id: FX.services.corteA, bps: 5000 });
    const list = await ok(TeamListOutput, "resources", "resources.list", { ...owner, body: {} });
    expect(list.resources.find((r) => r.id === id.caio)).toMatchObject({ kind: "professional", agenda_linked: true });
  });

  it("1 · reserva composta tudo ou nada: o conflito da cadeira recusa a reserva inteira e não prende Caio", async () => {
    t10 = await day("10:00");
    const b = await ok(TeamBookingOutput, "resources", "resources.booking_create", { ...owner, key: true,
      body: { service_id: FX.services.corteA, customer_id: FX.customers.abInA, professional_id: id.bia, resource_ids: [id.cadeira], starts_at: t10 } });
    expect(b.booking).toMatchObject({ status: "confirmed", agreed_price_cents: 6000, commission_bps: 5000, commission_cents: 0, ends_at: plusMin(t10, 30) });
    expect(b.booking.resources.map((r) => r.kind).sort()).toEqual(["chair", "professional"]);
    bookingId = b.booking.id;
    await fails("resources", "resources.booking_create", { ...owner, key: true,
      body: { service_id: FX.services.corteA, professional_id: id.caio, resource_ids: [id.cadeira], starts_at: plusMin(t10, 15) } }, "SLOT_CONFLICT", "chair");
    const [{ n }] = await sql<{ n: number }>("select count(*)::int as n from public.team_allocations where resource_id = $1", [id.caio]);
    expect(n).toBe(0);
    const avail = await ok(TeamAvailabilityOutput, "resources", "resources.availability", { ...owner,
      body: { service_id: FX.services.corteA, professional_id: id.caio, resource_ids: [id.cadeira], window: { starts_at: plusMin(t10, -60), ends_at: plusMin(t10, 120) } } });
    expect(avail.slots.map((s) => s.starts_at)).not.toContain(t10);
    expect(avail.slots.map((s) => s.starts_at)).toContain(plusMin(t10, 60));
  });

  it("2 · a agenda individual do dono e a equipe não se sobrepõem, nos dois sentidos", async () => {
    const t11 = await day("11:00");
    await ok(BookingOutput, "scheduling", "booking.create", { ...owner, key: true,
      body: { customer_id: null, service_id: FX.services.corteA, resource_id: FX.resources.A, slot: { starts_at: t11, ends_at: plusMin(t11, 30) }, quote_id: null, mode: "confirm" } });
    await fails("resources", "resources.booking_create", { ...owner, key: true,
      body: { service_id: FX.services.corteA, professional_id: id.caio, starts_at: t11 } }, "SLOT_CONFLICT", "agenda");
    const t14 = await day("14:00");
    await ok(TeamBookingOutput, "resources", "resources.booking_create", { ...owner, key: true,
      body: { service_id: FX.services.corteA, professional_id: id.caio, resource_ids: [id.sala], starts_at: t14 } });
    await fails("scheduling", "booking.create", { ...owner, key: true,
      body: { customer_id: null, service_id: FX.services.corteA, resource_id: FX.resources.A, slot: { starts_at: t14, ends_at: plusMin(t14, 30) }, quote_id: null, mode: "confirm" } }, "SLOT_CONFLICT", "team");
    const sched = await ok(TeamScheduleOutput, "resources", "resources.schedule", { ...owner, body: { window: { starts_at: t10, ends_at: plusMin(t10, 600) } } });
    expect(sched.bookings.map((x) => x.professional_name)).toEqual(["Bia (equipe)", "Caio (equipe)"]);
  });

  it("3 · concluir: recebível no Caixa pelo preço combinado e comissão uma vez; o Caixa registra o pagamento", async () => {
    await sql(`update public.team_bookings set starts_at = now() - interval '2 hours', ends_at = now() - interval '90 minutes',
      occupied_range = tstzrange(now() - interval '2 hours', now() - interval '80 minutes', '[)') where id = $1`, [bookingId]);
    const [{ version }] = await sql<{ version: number }>("select version from public.team_bookings where id = $1", [bookingId]);
    const key = newKey();
    const done = await ok(TeamBookingOutput, "resources", "resources.booking_complete", { ...owner, key, body: { booking_id: bookingId, expected_version: version } });
    expect(done.booking).toMatchObject({ status: "completed", commission_cents: 3000 });
    const again = await ok(TeamBookingOutput, "resources", "resources.booking_complete", { ...owner, key, body: { booking_id: bookingId, expected_version: version } });
    expect(again.booking.receivable_id).toBe(done.booking.receivable_id);
    await fails("resources", "resources.booking_complete", { ...owner, key: true, body: { booking_id: bookingId, expected_version: done.booking.version } }, "POLICY_REJECTED", "status");
    const period = { starts_at: iso(new Date(Date.now() - 86_400_000)), ends_at: iso(new Date(Date.now() + 86_400_000)) };
    const ledger = await ok(FinanceLedgerOutput, "finance", "finance.ledger", { ...owner, body: { period } });
    const rec = ledger.receivables.find((r) => r.id === done.booking.receivable_id)!;
    expect(rec).toMatchObject({ amount_cents: 6000, status: "open", customer_id: FX.customers.abInA });
    await ok(PaymentEntry, "finance", "finance.record_payment", { ...owner, key: true, body: { receivable_id: rec.id, amount_cents: 6000, method: "pix", received_at: iso(new Date()) } });
    const [{ n }] = await sql<{ n: number }>("select count(*)::int as n from public.team_commission_entries where booking_id = $1", [bookingId]);
    expect(n).toBe(1);
  });

  it("4 · turma: lotação, presença gera recebível, comissão sobre as presenças; estorno uma vez", async () => {
    const t16 = await day("16:00");
    let c = await ok(TeamClassOutput, "resources", "resources.class_create", { ...owner, key: true,
      body: { service_id: FX.services.corteA, professional_id: id.bia, room_id: id.sala, title: "Oficina de corte", starts_at: t16, capacity: 1, seat_price_cents: 4000 } });
    c = await ok(TeamClassOutput, "resources", "resources.class_enroll", { ...owner, key: true, body: { class_id: c.class.id, customer_id: FX.customers.abInA } });
    expect(c.class).toMatchObject({ booked: 1, capacity: 1 });
    await fails("resources", "resources.class_enroll", { ...owner, key: true, body: { class_id: c.class.id, customer_id: FX.customers.guestInA } }, "POLICY_REJECTED", "capacity");
    await sql(`update public.team_classes set starts_at = now() - interval '1 hour', ends_at = now() - interval '30 minutes',
      occupied_range = tstzrange(now() - interval '1 hour', now() - interval '20 minutes', '[)') where id = $1`, [c.class.id]);
    const [{ version }] = await sql<{ version: number }>("select version from public.team_classes where id = $1", [c.class.id]);
    const done = await ok(TeamClassOutput, "resources", "resources.class_complete", { ...owner, key: true,
      body: { class_id: c.class.id, expected_version: version, attended_seat_ids: [c.class.seats[0]!.id] } });
    expect(done.class).toMatchObject({ status: "completed", commission_cents: 2000 });
    expect(done.class.seats[0]).toMatchObject({ status: "attended" });
    expect(done.class.seats[0]!.receivable_id).not.toBeNull();

    const period = { starts_at: iso(new Date(Date.now() - 86_400_000)), ends_at: iso(new Date(Date.now() + 86_400_000)) };
    const report = await ok(TeamCommissionsOutput, "resources", "resources.commissions", { ...owner, body: { period } });
    expect(report.professionals.find((p) => p.professional_id === id.bia)).toMatchObject({ accrued_cents: 5000, reversed_cents: 0, net_cents: 5000, entries: 2 });
    const entry = report.entries.find((e) => e.class_id === c.class.id)!;
    const rev = await ok(TeamCommissionEntryOutput, "resources", "resources.commission_reverse", { ...owner, key: true, body: { entry_id: entry.id } });
    expect(rev.entry).toMatchObject({ kind: "reversal", amount_cents: -2000, reversal_of: entry.id });
    await fails("resources", "resources.commission_reverse", { ...owner, key: true, body: { entry_id: entry.id } }, "POLICY_REJECTED", "reversed");
    const after = await ok(TeamCommissionsOutput, "resources", "resources.commissions", { ...owner, body: { period } });
    expect(after.professionals.find((p) => p.professional_id === id.bia)).toMatchObject({ net_cents: 3000 });
  });

  it("SEC · outro dono e cliente com login não leem nem reservam; comando sem chave é recusado", async () => {
    await fails("resources", "resources.list", { as: U.ownerB, tenant: T.A, body: {} }, "FORBIDDEN");
    await fails("resources", "resources.booking_create", { as: U.ownerB, tenant: T.A, key: true,
      body: { service_id: FX.services.corteA, professional_id: id.bia, starts_at: await day("12:00") } }, "FORBIDDEN");
    await fails("resources", "resources.schedule", { as: U.customerAB, tenant: T.A, body: { window: { starts_at: t10, ends_at: plusMin(t10, 60) } } }, "FORBIDDEN");
    const noKey = await call("resources", "resources.save", { ...owner, body: { kind: "room", name: "Sala 9" } });
    expect(noKey.error?.field).toBe("idempotency_key");
    await fails("resources", "resources.booking_create", { as: U.ownerB, tenant: T.B, key: true,
      body: { service_id: FX.services.sessaoB, professional_id: id.bia, starts_at: await day("12:00") } }, "NOT_FOUND", "resource_ids");
  });
});
