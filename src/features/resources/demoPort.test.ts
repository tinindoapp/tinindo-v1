import { beforeEach, describe, expect, it } from "vitest";
import { createDemoPort, DEMO_CUSTOMERS, resetDemoState } from "./demoPort.ts";
import { localInstant } from "./labels.ts";

const code = (p: Promise<unknown>) => p.then(() => "ok", (e: { code: string; field?: string }) => `${e.code}/${e.field ?? "-"}`);
const TZ = "America/Sao_Paulo";
const CORTE = "40000000-0000-4000-8000-0000000000a1";

describe("demonstração da Equipe (mesmas regras do banco)", () => {
  beforeEach(() => resetDemoState());
  const setup = async () => {
    const port = createDemoPort();
    const { resources } = await port.list();
    const by = (name: string) => resources.find((r) => r.name === name)!.id;
    return { port, bia: by("Bia"), caio: by("Caio (você)"), sala: by("Sala de coloração"), c1: by("Cadeira 1"), c2: by("Cadeira 2") };
  };

  it("reserva composta tudo ou nada: o conflito da cadeira recusa tudo e não prende a outra profissional", async () => {
    const { port, bia, caio, c1, c2 } = await setup();
    const at = localInstant("2026-10-21", "10:00", TZ);
    const b = await port.book({ service_id: CORTE, professional_id: bia, resource_ids: [c1], customer_id: DEMO_CUSTOMERS[0]!.id, starts_at: at }, "k1");
    expect(b).toMatchObject({ commission_bps: 5000, agreed_price_cents: 6000, status: "confirmed" });
    expect(await code(port.book({ service_id: CORTE, professional_id: caio, resource_ids: [c1], starts_at: at }, "k2"))).toBe("SLOT_CONFLICT/chair");
    expect(await code(port.book({ service_id: CORTE, professional_id: bia, resource_ids: [c2], starts_at: at }, "k3"))).toBe("SLOT_CONFLICT/professional");
    // Caio e a Cadeira 2 continuam livres: nada ficou preso pela metade.
    expect((await port.book({ service_id: CORTE, professional_id: caio, resource_ids: [c2], starts_at: at }, "k4")).status).toBe("confirmed");
    expect(await code(port.book({ service_id: CORTE, professional_id: caio, resource_ids: [c1, c1], starts_at: at }, "k5"))).toBe("VALIDATION_ERROR/resource_ids");
    expect(await code(port.book({ service_id: CORTE, professional_id: caio, starts_at: localInstant("2026-10-21", "21:00", TZ) }, "k6"))).toBe("SLOT_CONFLICT/hours");
    expect(await code(port.book({ service_id: CORTE, professional_id: caio, starts_at: localInstant("2026-10-21", "11:00", TZ) }, "k7"))).toBe("SLOT_CONFLICT/agenda");
    const slots = await port.availability(CORTE, bia, [c1], { starts_at: localInstant("2026-10-21", "09:00", TZ), ends_at: localInstant("2026-10-21", "12:00", TZ) });
    expect(slots.map((s) => s.starts_at)).not.toContain(at);
    expect(slots.map((s) => s.starts_at)).toContain(localInstant("2026-10-21", "11:00", TZ));
    // Repetir com a mesma chave devolve a mesma reserva.
    expect((await port.book({ service_id: CORTE, professional_id: bia, resource_ids: [c1], customer_id: DEMO_CUSTOMERS[0]!.id, starts_at: at }, "k1")).id).toBe(b.id);
  });

  it("concluir lança a comissão uma vez; estorno uma vez; cancelar libera todos os recursos", async () => {
    const { port, bia, c1 } = await setup();
    const { bookings } = await port.schedule({ starts_at: "2026-10-18T00:00:00Z", ends_at: "2026-10-25T00:00:00Z" });
    const past = bookings.find((b) => b.status === "confirmed" && Date.parse(b.starts_at) < Date.parse("2026-10-20T12:00:00Z"))!;
    const done = await port.completeBooking(past, "d1");
    expect(done).toMatchObject({ status: "completed", commission_cents: 3000 });
    expect(done.receivable_id).not.toBeNull();
    expect(await code(port.completeBooking(done, "d2"))).toBe("POLICY_REJECTED/status");
    const c = await port.commissions({ starts_at: "2026-10-01T03:00:00Z", ends_at: "2026-11-01T03:00:00Z" });
    expect(c.professionals[0]).toMatchObject({ professional_name: "Bia", accrued_cents: 3000, net_cents: 3000 });
    await port.reverseCommission(c.entries[0]!.id, "r1");
    expect(await code(port.reverseCommission(c.entries[0]!.id, "r2"))).toBe("POLICY_REJECTED/reversed");
    expect((await port.commissions({ starts_at: "2026-10-01T03:00:00Z", ends_at: "2026-11-01T03:00:00Z" })).professionals[0]!.net_cents).toBe(0);
    const at = localInstant("2026-10-22", "10:00", TZ);
    const b = await port.book({ service_id: CORTE, professional_id: bia, resource_ids: [c1], starts_at: at }, "b1");
    expect(await code(port.completeBooking(b, "b2"))).toBe("POLICY_REJECTED/starts_at");
    await port.cancelBooking(b, null, "b3");
    expect((await port.book({ service_id: CORTE, professional_id: bia, resource_ids: [c1], starts_at: at }, "b4")).status).toBe("confirmed");
  });

  it("turma: lotação, uma vaga por cliente; profissional e sala alocadas juntas", async () => {
    const { port, bia, sala } = await setup();
    const c = await port.createClass({ title: "Oficina", service_id: CORTE, professional_id: bia, room_id: sala, starts_at: localInstant("2026-10-21", "15:00", TZ), capacity: 1, seat_price_cents: 3000 }, "c1");
    expect(await code(port.book({ service_id: CORTE, professional_id: bia, starts_at: localInstant("2026-10-21", "15:00", TZ) }, "c2"))).toBe("SLOT_CONFLICT/professional");
    const e = await port.enroll(c.id, DEMO_CUSTOMERS[0]!.id, "e1");
    expect(e.booked).toBe(1);
    expect(await code(port.enroll(c.id, DEMO_CUSTOMERS[1]!.id, "e2"))).toBe("POLICY_REJECTED/capacity");
    const freed = await port.cancelSeat(e.seats[0]!.id, 1, "e3");
    expect(freed.booked).toBe(0);
    expect((await port.enroll(c.id, DEMO_CUSTOMERS[1]!.id, "e4")).booked).toBe(1);
    expect(await code(port.completeClass(freed, [], "e5"))).toBe("POLICY_REJECTED/starts_at");
    const cancelled = await port.cancelClass({ ...freed, version: 1 }, "e6");
    expect(cancelled.status).toBe("cancelled");
    expect((await port.book({ service_id: CORTE, professional_id: bia, resource_ids: [sala], starts_at: localInstant("2026-10-21", "15:00", TZ) }, "e7")).status).toBe("confirmed");
  });

  it("recursos: comissão só para profissional, um vínculo com a agenda, nome único por tipo", async () => {
    const { port } = await setup();
    expect(await code(port.save({ kind: "room", name: "Sala 2", commission_bps: 100 }, "s1"))).toBe("VALIDATION_ERROR/commission_bps");
    expect(await code(port.save({ kind: "professional", name: "Duda", agenda_linked: true }, "s2"))).toBe("POLICY_REJECTED/name");
    expect(await code(port.save({ kind: "chair", name: "cadeira 1" }, "s3"))).toBe("POLICY_REJECTED/name");
    expect((await port.save({ kind: "equipment", name: "Secador" }, "s4")).kind).toBe("equipment");
  });
});
