// UAT · Cabeleireira (docs/10) pelos handlers com o banco real: serviço de 90 min com intervalo; não cabe num
// buraco de 60 min; mudar a duração vale para reservas novas e preserva as antigas; reagendar dentro da política;
// mudar o preço base não altera o preço combinado de reservas confirmadas.
import { afterAll, describe, expect, it } from "vitest";
import { AvailabilityListOutput, BookingOutput, ScheduleSettings, ServiceSaveOutput } from "@contracts";
import { fails, FX, nextWeek, ok, plusMin, pool, T, U } from "./harness.ts";

const owner = { as: U.ownerA, tenant: T.A };
afterAll(() => pool.end());

describe("UAT cabeleireira", () => {
  let service = { id: "", version: 1 };
  let resourceId = "";
  let thu10 = "";
  let longBooking = { id: "", version: 1 };

  it("1a · cadastra Coloração: 90 min com 15 min de intervalo depois", async () => {
    const r = await ok(ServiceSaveOutput, "crm", "service.save", { ...owner, key: true, body: {
      name: "Coloração", duration_min: 90, buffer_after_min: 15, base_price_cents: 18000, min_price_cents: 15000 } });
    service = { id: r.service.id, version: r.service.version };
    const settings = await ok(ScheduleSettings, "scheduling", "schedule.settings", { ...owner, body: {} });
    resourceId = settings.resource_id;
    await ok(ScheduleSettings, "scheduling", "schedule.rules_save", { ...owner, key: true, body: { resource_id: resourceId, expected_version: settings.resource_version,
      rules: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, local_start: "09:00", local_end: "18:00" })) } });
  });

  it("1b · com um buraco de 60 min entre dois cortes, a coloração não é oferecida ali", async () => {
    thu10 = await nextWeek(4, "10:00");
    const thu11 = await nextWeek(4, "11:00");
    for (const start of [thu10, thu11]) {
      await ok(BookingOutput, "scheduling", "booking.create", { ...owner, key: true, body: {
        customer_id: FX.customers.abInA, guest_ref: null, service_id: FX.services.corteA, resource_id: resourceId,
        slot: { starts_at: start, ends_at: plusMin(start, 30) }, quote_id: null, mode: "confirm" } });
    }
    // Entre 10:30 (+10 de intervalo do corte) e 11:00 sobram 20 min; depois das 11:40 o dia está livre.
    const avail = await ok(AvailabilityListOutput, "scheduling", "availability.list", { ...owner, body: {
      resource_id: resourceId, service_id: service.id, window: { starts_at: await nextWeek(4, "09:00"), ends_at: await nextWeek(4, "18:00") } } });
    const starts = avail.slots.map((s) => s.starts_at);
    expect(starts).not.toContain(await nextWeek(4, "10:30"));
    expect(starts).not.toContain(await nextWeek(4, "09:00")); // 90 min + 15 invadem o corte das 10:00
    expect(starts).toContain(await nextWeek(4, "12:00"));
    // Nem forçando: a reserva respeita a mesma regra da listagem.
    await fails("scheduling", "booking.create", { ...owner, key: true, body: {
      customer_id: FX.customers.guestInA, guest_ref: null, service_id: service.id, resource_id: resourceId,
      slot: { starts_at: await nextWeek(4, "10:30"), ends_at: await nextWeek(4, "12:00") }, quote_id: null, mode: "confirm" } }, "SLOT_CONFLICT");
    const r = await ok(BookingOutput, "scheduling", "booking.create", { ...owner, key: true, body: {
      customer_id: FX.customers.guestInA, guest_ref: null, service_id: service.id, resource_id: resourceId,
      slot: { starts_at: await nextWeek(4, "13:00"), ends_at: await nextWeek(4, "14:30") }, quote_id: null, mode: "confirm" } });
    longBooking = { id: r.booking.id, version: r.booking.version };
    expect(r.booking.agreed_price_cents).toBe(18000);
  });

  it("2 · muda a duração para 120 min: reservas novas usam a nova; a antiga fica como estava", async () => {
    const r = await ok(ServiceSaveOutput, "crm", "service.save", { ...owner, key: true, body: {
      service_id: service.id, expected_version: service.version, name: "Coloração", duration_min: 120, buffer_after_min: 15,
      base_price_cents: 18000, min_price_cents: 15000 } });
    expect(r.service.duration_min).toBe(120);
    service.version = r.service.version;
    // A reserva antiga continua com 90 min.
    const old = await ok(BookingOutput, "scheduling", "booking.get", { ...owner, body: { booking_id: longBooking.id } });
    expect(Date.parse(old.booking.ends_at) - Date.parse(old.booking.starts_at)).toBe(90 * 60_000);
    // Nova reserva com 90 min é recusada: a duração é a do serviço.
    const fri10 = await nextWeek(5, "10:00");
    await fails("scheduling", "booking.create", { ...owner, key: true, body: {
      customer_id: FX.customers.abInA, guest_ref: null, service_id: service.id, resource_id: resourceId,
      slot: { starts_at: fri10, ends_at: plusMin(fri10, 90) }, quote_id: null, mode: "confirm" } }, "VALIDATION_ERROR", "slot");
    const fresh = await ok(BookingOutput, "scheduling", "booking.create", { ...owner, key: true, body: {
      customer_id: FX.customers.abInA, guest_ref: null, service_id: service.id, resource_id: resourceId,
      slot: { starts_at: fri10, ends_at: plusMin(fri10, 120) }, quote_id: null, mode: "confirm" } });
    expect(Date.parse(fresh.booking.ends_at) - Date.parse(fresh.booking.starts_at)).toBe(120 * 60_000);
  });

  it("3 · reagenda a coloração: ou o novo horário entra e o antigo sai, ou nada muda", async () => {
    const fri14 = await nextWeek(5, "14:00");
    // Reagendar replaneja com a duração ATUAL do serviço (120 min): o horário antigo de 90 min não serve.
    await fails("scheduling", "booking.reschedule", { ...owner, key: true, body: { booking_id: longBooking.id, expected_version: longBooking.version,
      slot: { starts_at: fri14, ends_at: plusMin(fri14, 90) }, quote_id: null } }, "VALIDATION_ERROR", "slot");
    // Para horário ocupado (sexta 10:00–12:00): conflito e a reserva original permanece.
    await fails("scheduling", "booking.reschedule", { ...owner, key: true, body: { booking_id: longBooking.id, expected_version: longBooking.version,
      slot: { starts_at: await nextWeek(5, "11:00"), ends_at: await nextWeek(5, "13:00") }, quote_id: null } }, "SLOT_CONFLICT");
    const same = await ok(BookingOutput, "scheduling", "booking.get", { ...owner, body: { booking_id: longBooking.id } });
    expect(same.booking.starts_at).toBe(await nextWeek(4, "13:00"));
    expect(same.booking.version).toBe(longBooking.version);
    const moved = await ok(BookingOutput, "scheduling", "booking.reschedule", { ...owner, key: true, body: { booking_id: longBooking.id, expected_version: longBooking.version,
      slot: { starts_at: fri14, ends_at: plusMin(fri14, 120) }, quote_id: null } });
    expect(moved.booking.starts_at).toBe(fri14);
    expect(Date.parse(moved.booking.ends_at) - Date.parse(moved.booking.starts_at)).toBe(120 * 60_000);
    longBooking.version = moved.booking.version;
    // O horário antigo voltou a ficar livre para um corte.
    const avail = await ok(AvailabilityListOutput, "scheduling", "availability.list", { ...owner, body: {
      resource_id: resourceId, service_id: FX.services.corteA, window: { starts_at: await nextWeek(4, "12:00"), ends_at: await nextWeek(4, "18:00") } } });
    expect(avail.slots.map((s) => s.starts_at)).toContain(await nextWeek(4, "13:00"));
  });

  it("4 · subir o preço base para R$220 não muda o preço combinado da reserva confirmada", async () => {
    await ok(ServiceSaveOutput, "crm", "service.save", { ...owner, key: true, body: {
      service_id: service.id, expected_version: service.version, name: "Coloração", duration_min: 120, buffer_after_min: 15,
      base_price_cents: 22000, min_price_cents: 15000 } });
    const b = await ok(BookingOutput, "scheduling", "booking.get", { ...owner, body: { booking_id: longBooking.id } });
    expect(b.booking.agreed_price_cents).toBe(18000);
    const mon10 = await nextWeek(1, "10:00");
    const next = await ok(BookingOutput, "scheduling", "booking.create", { ...owner, key: true, body: {
      customer_id: FX.customers.abInA, guest_ref: null, service_id: service.id, resource_id: resourceId,
      slot: { starts_at: mon10, ends_at: plusMin(mon10, 120) }, quote_id: null, mode: "confirm" } });
    expect(next.booking.agreed_price_cents).toBe(22000);
  });
});
