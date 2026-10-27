import { beforeEach, describe, expect, it } from "vitest";
import { createDemoPort, resetDemoState } from "./demoPort.ts";

const code = (p: Promise<unknown>) => p.then(() => "ok", (e: { code: string; field?: string }) => `${e.code}/${e.field ?? "-"}`);
const PERIOD = { starts_at: "2026-09-20T00:00:00Z", ends_at: "2026-10-21T00:00:00Z" };

describe("demonstração de Materiais (mesmas regras do banco)", () => {
  beforeEach(() => resetDemoState());
  const setup = async () => {
    const port = createDemoPort();
    const { items } = await port.list();
    const by = (n: string) => items.find((i) => i.name === n)!;
    const bookings = await port.bookings(PERIOD);
    return { port, sh: by("Shampoo"), po: by("Pomada"), corte: bookings.find((b) => b.service_name === "Corte")!, barba: bookings.find((b) => b.service_name === "Barba")! };
  };

  it("consumo pela ficha sai uma vez com custo médio; estorno devolve exato, uma vez; registrar de novo", async () => {
    const { port, corte } = await setup();
    const c = await port.consume(corte.booking_id, null, "c1");
    expect(c).toMatchObject({ cost_cents: 400, source: "usage" }); // 20 ml × 5 + 1 pomada × 300
    expect(await code(port.consume(corte.booking_id, null, "c2"))).toBe("POLICY_REJECTED/consumed");
    expect((await port.consume(corte.booking_id, null, "c1")).id).toBe(c.id);
    const r = await port.reverseConsumption(c, "r1");
    expect(await code(port.reverseConsumption(r, "r2"))).toBe("POLICY_REJECTED/reversed");
    const { items } = await port.list();
    expect(items.find((i) => i.name === "Shampoo")).toMatchObject({ on_hand: 1000, stock_value_cents: 5000, unit_cost_cents: 5 });
    expect((await port.consume(corte.booking_id, null, "c3")).status).toBe("active");
  });

  it("tudo ou nada: falta de um item recusa o consumo inteiro; serviço sem ficha é recusado", async () => {
    const { port, sh, po, barba } = await setup();
    expect(await code(port.consume(barba.booking_id, null, "x1"))).toBe("POLICY_REJECTED/usage");
    expect(await code(port.consume(barba.booking_id, [{ item_id: sh.id, quantity: 10 }, { item_id: po.id, quantity: 11 }], "x2"))).toBe("POLICY_REJECTED/stock");
    const { items } = await port.list();
    expect(items.find((i) => i.id === sh.id)?.on_hand).toBe(1000);
    expect(await code(port.consume(barba.booking_id, [{ item_id: sh.id, quantity: 1 }, { item_id: sh.id, quantity: 2 }], "x3"))).toBe("VALIDATION_ERROR/lines");
  });

  it("compra recalcula o custo médio; estorno da compra exige saldo; margem só nos atendimentos com uso", async () => {
    const { port, sh, corte } = await setup();
    await port.purchase(null, "2026-10-20T11:00:00Z", [{ item_id: sh.id, quantity: 1000, total_cents: 7000 }], true, "p1");
    expect((await port.list()).items.find((i) => i.id === sh.id)).toMatchObject({ on_hand: 2000, stock_value_cents: 12000, unit_cost_cents: 6 });
    await port.consume(corte.booking_id, [{ item_id: sh.id, quantity: 25.5 }], "c1");
    const m = await port.margin(PERIOD);
    expect(m.services.find((s) => s.service_name === "Corte")).toMatchObject({ completed: 1, with_materials: 1, material_cost_cents: 153, margin_cents: 5847, margin_bps: 9745 });
    expect(m.totals).toMatchObject({ completed: 2, with_materials: 1 });
    const [latest] = await port.purchases(PERIOD);
    const back = await port.reversePurchase(latest!, "pr1");
    expect(back.status).toBe("reversed");
    expect(await code(port.reversePurchase(back, "pr2"))).toBe("POLICY_REJECTED/status");
    const sh2 = (await port.list()).items.find((i) => i.id === sh.id)!;
    expect(sh2.on_hand).toBe(974.5);
    expect(await code(port.adjust(sh2, sh2.on_hand, "igual", "a1"))).toBe("POLICY_REJECTED/counted");
    expect((await port.adjust(sh2, 900, "vazou", "a2")).on_hand).toBe(900);
  });
});
