// P29 pelos handlers com o banco real: regras e zonas por CEP de 5 dígitos → duas reservas do P03 viram visitas →
// o deslocamento ocupa a agenda (some das vagas e impede reserva por cima) → roteiro em ordem com janela de chegada →
// fora da área e sem tempo de chegar são recusados sem mudar nada → cancelar no P03 pede recálculo → recalcular e
// tirar a visita soltam o horário. SEC: outro dono, cliente e reserva de outro negócio.
import { afterAll, describe, expect, it } from "vitest";
import { AvailabilityListOutput, BookingOutput, FieldRebuildOutput, FieldRouteOutput, FieldSettingsGetOutput, FieldSettingsOutput, FieldTravelOutput,
  FieldVisitDetachOutput, FieldVisitOutput, FieldZoneForOutput, FieldZoneOutput } from "@contracts";
import { call, fails, FX, iso, newKey, ok, plusMin, pool, sql, T, U } from "./harness.ts";

const owner = { as: U.ownerA, tenant: T.A };
afterAll(() => pool.end());

describe("P29 · atendimento a domicílio pelos handlers", () => {
  let day = "";
  const at = async (hhmm: string) => {
    const [{ ts }] = await sql<{ ts: string }>(`select (($1::date + $2::time) at time zone 'America/Sao_Paulo') as ts`, [day, hhmm]);
    return iso(new Date(ts));
  };
  const book = async (hhmm: string) => (await ok(BookingOutput, "scheduling", "booking.create", { ...owner, key: true, body: {
    customer_id: FX.customers.abInA, guest_ref: null, service_id: FX.services.corteA, resource_id: FX.resources.A,
    slot: { starts_at: await at(hhmm), ends_at: plusMin(await at(hhmm), 30) }, quote_id: null, mode: "confirm" } })).booking;
  const zone: Record<string, string> = {};
  const bk: Record<string, { id: string; version: number }> = {};

  it("0 · regras, zonas por CEP de 5 dígitos, tempo entre zonas e área pela distância declarada", async () => {
    const [{ d }] = await sql<{ d: string }>(`select to_char(d0 + (7 - extract(dow from d0)::int) % 7, 'YYYY-MM-DD') as d from (select (now() at time zone 'America/Sao_Paulo')::date + 33 as d0) x`);
    day = d; // domingo: os outros testes só abrem seg–sáb, e o expediente deste dia é só nosso
    await sql(`insert into public.availability_rules (tenant_id, resource_id, weekday, local_start, local_end)
      select $1, $2, extract(dow from $3::date)::int, '08:00', '20:00'
      where not exists (select 1 from public.availability_rules where resource_id = $2 and weekday = extract(dow from $3::date)::int)`, [T.A, FX.resources.A, day]);
    const cur = await ok(FieldSettingsGetOutput, "field-service", "field.settings", { ...owner, body: {} });
    const s = await ok(FieldSettingsOutput, "field-service", "field.settings_save", { ...owner, key: true, body: {
      expected_version: cur.zones.length || cur.settings.version > 1 ? cur.settings.version : null,
      default_travel_min: 30, same_zone_travel_min: 10, arrival_window_min: 30, max_km: 15 } });
    expect(s.settings).toMatchObject({ enabled: true, max_km: 15, arrival_window_min: 30 });
    zone.centro = (await ok(FieldZoneOutput, "field-service", "field.zone_save", { ...owner, key: true, body: { name: "Centro (int)", cep_prefixes: ["01010", "01011"], distance_km: 2, travel_from_base_min: 20 } })).zone.id;
    zone.pinheiros = (await ok(FieldZoneOutput, "field-service", "field.zone_save", { ...owner, key: true, body: { name: "Pinheiros (int)", cep_prefixes: ["05410"], distance_km: 8, travel_from_base_min: 35 } })).zone.id;
    const far = await ok(FieldZoneOutput, "field-service", "field.zone_save", { ...owner, key: true, body: { name: "Longe (int)", cep_prefixes: ["06460"], distance_km: 25, travel_from_base_min: 60 } });
    zone.longe = far.zone.id;
    expect(far.zone.in_area).toBe(false);
    await fails("field-service", "field.zone_save", { ...owner, key: true, body: { name: "Repetida", cep_prefixes: ["01011"], distance_km: 1, travel_from_base_min: 10 } }, "POLICY_REJECTED", "cep_prefixes");
    const t = await ok(FieldTravelOutput, "field-service", "field.travel_save", { ...owner, key: true, body: { zone_a: zone.pinheiros, zone_b: zone.centro, minutes: 25 } });
    expect(t.travel_times.some((x) => [x.zone_a, x.zone_b].sort().join() === [zone.centro, zone.pinheiros].sort().join() && x.minutes === 25)).toBe(true);
    expect(await ok(FieldZoneForOutput, "field-service", "field.zone_for", { ...owner, body: { cep: "01011-100" } })).toMatchObject({ cep5: "01011", in_area: true, zone: { id: zone.centro } });
    expect(await ok(FieldZoneForOutput, "field-service", "field.zone_for", { ...owner, body: { cep: "99999000" } })).toMatchObject({ zone: null, in_area: false });
  });

  it("1 · duas visitas: o deslocamento ocupa a agenda e o roteiro sai em ordem, com janela de chegada", async () => {
    bk.a = await book("10:00");
    bk.b = await book("11:30");
    const key = newKey();
    const first = await ok(FieldVisitOutput, "field-service", "field.visit_attach", { ...owner, key, body: { booking_id: bk.a.id, zone_id: zone.centro, cep5: "01011" } });
    expect(first.stop).toMatchObject({ travel_min: 20, depart_at: await at("09:40"), arrival_from: await at("09:30"), arrival_to: await at("10:00") });
    expect((await ok(FieldVisitOutput, "field-service", "field.visit_attach", { ...owner, key, body: { booking_id: bk.a.id, zone_id: zone.centro, cep5: "01011" } })).stop.visit_id)
      .toBe(first.stop.visit_id);
    await fails("field-service", "field.visit_attach", { ...owner, key: true, body: { booking_id: bk.b.id, zone_id: zone.pinheiros, cep5: "01011" } }, "VALIDATION_ERROR", "cep");
    await ok(FieldVisitOutput, "field-service", "field.visit_attach", { ...owner, key: true, body: { booking_id: bk.b.id, zone_id: zone.pinheiros } });
    const route = await ok(FieldRouteOutput, "field-service", "field.route", { ...owner, body: { day } });
    expect(route.stops.map((s) => [s.zone_name, s.travel_min, s.depart_at])).toEqual([["Centro (int)", 20, await at("09:40")], ["Pinheiros (int)", 25, await at("11:05")]]);
    expect(route.needs_rebuild).toBe(false);
    expect(JSON.stringify(route)).not.toMatch(/latitude|longitude|endereco|address/i);
    // O deslocamento some das vagas e impede reserva por cima.
    const avail = await ok(AvailabilityListOutput, "scheduling", "availability.list", { ...owner, body: {
      resource_id: FX.resources.A, service_id: FX.services.corteA, window: { starts_at: await at("08:00"), ends_at: await at("13:00") } } });
    const starts = avail.slots.map((s) => s.starts_at);
    expect(starts).not.toContain(await at("09:30"));
    expect(starts).not.toContain(await at("10:30"));
    expect(starts).toContain(await at("08:30"));
    await fails("scheduling", "booking.create", { ...owner, key: true, body: { customer_id: FX.customers.abInA, guest_ref: null, service_id: FX.services.corteA,
      resource_id: FX.resources.A, slot: { starts_at: await at("11:00"), ends_at: await at("11:30") }, quote_id: null, mode: "confirm" } }, "SLOT_CONFLICT");
  });

  it("2 · fora da área e sem tempo de chegar: recusado, nada muda", async () => {
    bk.c = await book("14:00");
    bk.d = await book("14:45");
    await fails("field-service", "field.visit_attach", { ...owner, key: true, body: { booking_id: bk.c.id, zone_id: zone.longe } }, "POLICY_REJECTED", "area");
    await ok(FieldVisitOutput, "field-service", "field.visit_attach", { ...owner, key: true, body: { booking_id: bk.c.id, zone_id: zone.centro } });
    await fails("field-service", "field.visit_attach", { ...owner, key: true, body: { booking_id: bk.d.id, zone_id: zone.pinheiros } }, "SLOT_CONFLICT", "travel");
    const route = await ok(FieldRouteOutput, "field-service", "field.route", { ...owner, body: { day } });
    expect(route.stops).toHaveLength(3);
    expect(route.bookings.find((b) => b.booking_id === bk.d.id)?.is_visit).toBe(false);
  });

  it("3 · cancelar no P03 pede recálculo; recalcular refaz; tirar a visita solta o horário", async () => {
    await ok(BookingOutput, "scheduling", "booking.cancel", { ...owner, key: true, body: { booking_id: bk.b.id, expected_version: bk.b.version, reason: "Cliente desmarcou" } });
    let route = await ok(FieldRouteOutput, "field-service", "field.route", { ...owner, body: { day } });
    expect(route.stops.map((s) => s.booking_id)).toEqual([bk.a.id, bk.c.id]);
    expect(route.needs_rebuild).toBe(true);
    expect(route.stops[1]).toMatchObject({ travel_min: null, depart_at: await at("13:35") }); // o bloqueio antigo segue protegendo a agenda
    const rebuilt = await ok(FieldRebuildOutput, "field-service", "field.route_rebuild", { ...owner, key: true, body: { day } });
    expect(rebuilt).toEqual({ day, stops: 2 });
    route = await ok(FieldRouteOutput, "field-service", "field.route", { ...owner, body: { day } });
    expect(route.stops.map((s) => s.travel_min)).toEqual([20, 10]);
    expect(route.needs_rebuild).toBe(false);
    expect(await ok(FieldVisitDetachOutput, "field-service", "field.visit_detach", { ...owner, key: true, body: { booking_id: bk.c.id } })).toEqual({ booking_id: bk.c.id, detached: true });
    const [{ n }] = await sql<{ n: number }>(`select count(*)::int as n from public.availability_blocks where tenant_id = $1 and removed_at is null and label like 'Deslocamento%' and period && tstzrange($2, $3)`,
      [T.A, await at("13:00"), await at("14:00")]);
    expect(n).toBe(0);
  });

  it("SEC · outro dono e cliente não veem; reserva de outro negócio não vira visita", async () => {
    expect((await call("field-service", "field.route", { as: U.ownerB, tenant: T.A, body: { day } })).status).toBe(403);
    expect((await call("field-service", "field.settings", { as: U.customerAB, tenant: T.A, body: {} })).status).toBe(403);
    const zb = await ok(FieldZoneOutput, "field-service", "field.zone_save", { as: U.ownerB, tenant: T.B, key: true, body: { name: "Zona B (int)", distance_km: 1, travel_from_base_min: 10 } });
    await fails("field-service", "field.visit_attach", { as: U.ownerB, tenant: T.B, key: true, body: { booking_id: bk.a.id, zone_id: zb.zone.id } }, "NOT_FOUND");
    const [{ n }] = await sql<{ n: number }>(`select count(*)::int as n from public.audit_events where action like 'field.visit%' and coalesce(after::text, '') ~ 'cep5|01011'`);
    expect(n).toBe(0);
  });
});
