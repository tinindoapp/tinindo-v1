// Agenda do personal pelos handlers com o banco real: série com terça e quinta (um series_id) → series_id em
// booking.get e booking.list → booking.series → "cancelar os próximos" (idempotente pela chave, versão conferida) →
// o dono vê a série com os passados intactos. SEC: outro dono não lê nem cancela.
import { afterAll, describe, expect, it } from "vitest";
import { BookingCancelSeriesFromOutput, BookingCreateSeriesOutput, BookingListOutput, BookingOutput, BookingSeriesOutput } from "@contracts";
import { call, fails, FX, newKey, nextWeek, ok, plusMin, pool, rpc, T, U } from "./harness.ts";

afterAll(() => pool.end());
const owner = { as: U.ownerA, tenant: T.A };

describe("Agenda do personal · série e cancelar os próximos", () => {
  let seriesId = "";
  let created: { id: string; starts_at: string; version: number }[] = [];

  it("0 · expediente das 6h às 21h", async () => {
    const rules = [1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, local_start: "06:00", local_end: "21:00" }));
    const settings = (await call("scheduling", "schedule.settings", { ...owner, body: {} })).data as { resource_version: number };
    expect((await rpc(U.ownerA, "scheduling_rules_save", { p_tenant_id: T.A, p_resource_id: FX.resources.A,
      p_expected_version: settings.resource_version, p_rules: rules, p_idem_key: newKey(), p_request_hash: "a".repeat(64) })).error).toBeNull();
  });

  it("1 · terça e quinta numa série só, com series_id na leitura", async () => {
    const tuesday = await nextWeek(2, "06:30");
    const body = { customer_id: FX.customers.abInA, guest_ref: null, service_id: FX.services.corteA, resource_id: FX.resources.A,
      slot: { starts_at: tuesday, ends_at: plusMin(tuesday, 30) }, weeks: 3, all_or_nothing: false, weekdays: [2, 4] };
    const key = newKey();
    const r = await ok(BookingCreateSeriesOutput, "scheduling", "booking.create_series", { ...owner, key, body });
    expect(r.created).toHaveLength(6);
    expect(new Set(r.created.map((b) => b.series_id))).toEqual(new Set([r.series_id]));
    seriesId = r.series_id;
    created = r.created;
    const again = await ok(BookingCreateSeriesOutput, "scheduling", "booking.create_series", { ...owner, key, body });
    expect(again.series_id).toBe(seriesId);
    const one = await ok(BookingOutput, "scheduling", "booking.get", { ...owner, body: { booking_id: created[0]!.id } });
    expect(one.booking.series_id).toBe(seriesId);
    const list = await ok(BookingListOutput, "scheduling", "booking.list", { ...owner, body: { window: { starts_at: tuesday, ends_at: plusMin(tuesday, 60 * 24 * 20) } } });
    expect(list.bookings.filter((b) => b.series_id === seriesId)).toHaveLength(6);
    const s = await ok(BookingSeriesOutput, "scheduling", "booking.series", { ...owner, body: { series_id: seriesId } });
    expect(s.bookings.map((b) => b.id)).toEqual(created.map((b) => b.id));
  });

  it("2 · cancelar o 3º e os próximos: idempotente, versão conferida, motivo", async () => {
    const third = created[2]!;
    const key = newKey();
    const body = { booking_id: third.id, expected_version: third.version, reason: "Aluno mudou de horário" };
    const r = await ok(BookingCancelSeriesFromOutput, "scheduling", "booking.cancel_series_from", { ...owner, key, body });
    expect(r.cancelled.map((b) => b.id)).toEqual(created.slice(2).map((b) => b.id));
    expect(r.cancelled.every((b) => b.status === "cancelled" && b.status_reason === "Aluno mudou de horário")).toBe(true);
    const again = await ok(BookingCancelSeriesFromOutput, "scheduling", "booking.cancel_series_from", { ...owner, key, body });
    expect(again).toEqual(r);
    await fails("scheduling", "booking.cancel_series_from", { ...owner, key: true, body }, "STALE_VERSION");
    const s = await ok(BookingSeriesOutput, "scheduling", "booking.series", { ...owner, body: { series_id: seriesId } });
    expect(s.bookings.map((b) => b.status)).toEqual(["confirmed", "confirmed", "cancelled", "cancelled", "cancelled", "cancelled"]);
  });

  it("3 · SEC: outro dono não lê nem cancela; sem motivo é recusado", async () => {
    await fails("scheduling", "booking.series", { as: U.ownerB, tenant: T.A, body: { series_id: seriesId } }, "FORBIDDEN");
    await fails("scheduling", "booking.cancel_series_from", { as: U.ownerB, tenant: T.A, key: true,
      body: { booking_id: created[0]!.id, expected_version: created[0]!.version, reason: "x" } }, "FORBIDDEN");
    await fails("scheduling", "booking.cancel_series_from", { ...owner, key: true,
      body: { booking_id: created[0]!.id, expected_version: created[0]!.version, reason: " " } }, "VALIDATION_ERROR");
  });
});
