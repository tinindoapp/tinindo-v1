import { describe, expect, it } from "vitest";
import { FX } from "@contracts/fixtures.ts";
import { createFixturePort } from "./fixturePort.ts";

const window = { starts_at: "2026-10-20T00:00:00-03:00", ends_at: "2026-10-21T00:00:00-03:00" };
const slot = { starts_at: "2026-10-20T15:45:00-03:00", ends_at: "2026-10-20T16:15:00-03:00" };
const base = {
  customer_id: FX.customers.abInA, guest_ref: null, service_id: FX.services.corteA,
  resource_id: FX.resources.A, quote_id: null, mode: "confirm" as const,
};
const K1 = "chave-teste-0000000001";
const K2 = "chave-teste-0000000002";

describe("emulação do motor de agenda (fixtures)", () => {
  it("disponibilidade respeita ocupação, buffers, pausa e passado", async () => {
    const port = createFixturePort();
    const { slots, timezone } = await port.availability({ resource_id: FX.resources.A, service_id: FX.services.corteA, window });
    const times = slots.map((s) => s.starts_at.slice(11, 16));
    expect(timezone).toBe("America/Sao_Paulo");
    expect(times[0]).toBe("13:00"); // manhã lotada; antes das 09:00 de hoje já passou
    expect(times).not.toContain("12:00"); // pausa
    expect(times).not.toContain("15:00"); // ocupado
    expect(times).not.toContain("15:30"); // buffer de 10 min do corte das 15:00
    expect(times).toContain("15:45");
  });

  it("cotação aplica a regra de horário com piso e prazo", async () => {
    const port = createFixturePort();
    const q = await port.quote({ service_id: FX.services.corteA, resource_id: FX.resources.A, slot });
    expect(q).toMatchObject({ base_price_cents: 6000, final_price_cents: 5100, reason_code: "OFF_PEAK_APPROVED", rule_version: 3 });
    const morning = await port.quote({
      service_id: FX.services.corteA, resource_id: FX.resources.A,
      slot: { starts_at: "2026-10-21T09:00:00-03:00", ends_at: "2026-10-21T09:30:00-03:00" },
    });
    expect(morning).toMatchObject({ final_price_cents: 6000, reason_code: "BASE_PRICE", rule_version: null });
  });

  it("cria com preço da cotação; repetir com a mesma chave devolve a mesma reserva", async () => {
    const port = createFixturePort();
    const q = await port.quote({ service_id: FX.services.corteA, resource_id: FX.resources.A, slot });
    const a = await port.create({ ...base, slot, quote_id: q!.quote_id }, K1);
    const b = await port.create({ ...base, slot, quote_id: q!.quote_id }, K1);
    expect(a).toEqual(b);
    expect(a).toMatchObject({ status: "confirmed", agreed_price_cents: 5100, version: 1 });
    expect((await port.listBookings(window)).filter((x) => x.starts_at === slot.starts_at)).toHaveLength(1);
  });

  it("mesma chave com outro payload → IDEMPOTENCY_MISMATCH; horário ocupado → SLOT_CONFLICT", async () => {
    const port = createFixturePort();
    await port.create({ ...base, slot }, K1);
    await expect(port.create({ ...base, slot, customer_id: FX.customers.guestInA }, K1)).rejects.toMatchObject({
      code: "IDEMPOTENCY_MISMATCH", status: 409,
    });
    await expect(port.create({ ...base, slot }, K2)).rejects.toMatchObject({ code: "SLOT_CONFLICT", status: 409 });
  });

  it("reagendar com versão antiga → STALE_VERSION e a reserva não muda", async () => {
    const port = createFixturePort();
    const id = "60000000-0000-4000-8000-000000000006";
    const moved = await port.reschedule({ booking_id: id, expected_version: 1, slot, quote_id: null }, K1);
    expect(moved).toMatchObject({ version: 2, starts_at: slot.starts_at, agreed_price_cents: 5100 });
    await expect(
      port.reschedule({ booking_id: id, expected_version: 1, slot: { starts_at: "2026-10-20T17:00:00-03:00", ends_at: "2026-10-20T17:30:00-03:00" }, quote_id: null }, K2),
    ).rejects.toMatchObject({ code: "STALE_VERSION" });
    expect((await port.getBooking(id)).starts_at).toBe(slot.starts_at);
  });

  it("reagendar para horário ocupado mantém a reserva antiga", async () => {
    const port = createFixturePort();
    const id = "60000000-0000-4000-8000-000000000006";
    await expect(
      port.reschedule({ booking_id: id, expected_version: 1, slot: { starts_at: "2026-10-20T11:25:00-03:00", ends_at: "2026-10-20T11:55:00-03:00" }, quote_id: null }, K1),
    ).rejects.toMatchObject({ code: "SLOT_CONFLICT" });
    expect(await port.getBooking(id)).toMatchObject({ starts_at: "2026-10-20T15:00:00-03:00", version: 1 });
  });

  it("cancelar libera o horário; cancelar de novo é recusado; repetir a chave não duplica", async () => {
    const port = createFixturePort();
    const id = "60000000-0000-4000-8000-000000000006";
    const c = await port.cancel({ booking_id: id, expected_version: 1, reason: "Cliente pediu" }, K1);
    expect(c.status).toBe("cancelled");
    expect(await port.cancel({ booking_id: id, expected_version: 1, reason: "Cliente pediu" }, K1)).toEqual(c);
    await expect(port.cancel({ booking_id: id, expected_version: 2, reason: "x" }, K2)).rejects.toMatchObject({ code: "POLICY_REJECTED" });
    const { slots } = await port.availability({ resource_id: FX.resources.A, service_id: FX.services.corteA, window });
    expect(slots.map((s) => s.starts_at.slice(11, 16))).toContain("15:00");
  });

  it("entrada inválida → VALIDATION_ERROR; atendimento inexistente → NOT_FOUND", async () => {
    const port = createFixturePort();
    await expect(port.cancel({ booking_id: "x", expected_version: 1, reason: "a" }, K1)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(port.getBooking("60000000-0000-4000-8000-000000000999")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("simulações de concorrência produzem os 409 uma única vez", async () => {
    const conflict = createFixturePort({ simulate: "conflito" });
    await expect(conflict.create({ ...base, slot }, K1)).rejects.toMatchObject({ code: "SLOT_CONFLICT" });
    await expect(conflict.create({ ...base, slot }, K2)).rejects.toMatchObject({ code: "SLOT_CONFLICT" }); // ocupado de verdade
    const stale = createFixturePort({ simulate: "versao" });
    const id = "60000000-0000-4000-8000-000000000006";
    await expect(stale.cancel({ booking_id: id, expected_version: 1, reason: "x" }, K1)).rejects.toMatchObject({ code: "STALE_VERSION" });
    expect((await stale.cancel({ booking_id: id, expected_version: 2, reason: "x" }, K2)).status).toBe("cancelled");
  });

  it("expediente: salvar com versão troca os horários livres; versão antiga → 409", async () => {
    const port = createFixturePort();
    const s0 = await port.settings();
    const tue = { weekday: 2, local_start: "14:00", local_end: "18:00" };
    const s1 = await port.saveRules({ resource_id: s0.resource_id, expected_version: s0.resource_version, rules: [tue] }, K1);
    expect(s1.rules).toEqual([tue]);
    const { slots } = await port.availability({ resource_id: FX.resources.A, service_id: FX.services.corteA, window });
    expect(slots.every((x) => x.starts_at.slice(11, 16) >= "14:00")).toBe(true);
    await expect(
      port.saveRules({ resource_id: s0.resource_id, expected_version: s0.resource_version, rules: [] }, K2),
    ).rejects.toMatchObject({ code: "STALE_VERSION" });
  });

  it("bloqueio não cobre atendimento ativo e some/volta dos horários livres", async () => {
    const port = createFixturePort();
    await expect(port.createBlock({ resource_id: FX.resources.A, range: { starts_at: "2026-10-20T14:50:00-03:00", ends_at: "2026-10-20T15:10:00-03:00" }, label: "Banco" }, K1))
      .rejects.toMatchObject({ code: "SLOT_CONFLICT" });
    const range = { starts_at: "2026-10-20T17:00:00-03:00", ends_at: "2026-10-20T18:00:00-03:00" };
    await port.createBlock({ resource_id: FX.resources.A, range, label: "Banco" }, K2);
    const free = async () => (await port.availability({ resource_id: FX.resources.A, service_id: FX.services.corteA, window })).slots.map((x) => x.starts_at.slice(11, 16));
    expect(await free()).not.toContain("17:00");
    const [plan] = (await port.dayPlans(window))!;
    const block = plan!.blocks.find((b) => b.label === "Banco")!;
    await port.removeBlock({ block_id: block.id!, expected_version: block.version! }, "chave-teste-0000000003");
    expect(await free()).toContain("17:00");
  });
});
