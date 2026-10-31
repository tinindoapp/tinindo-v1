import { beforeEach, describe, expect, it } from "vitest";
import { FX } from "@contracts/fixtures.ts";
import { createDemoLinkPort, createDemoPort, resetDemoState } from "./demoPort.ts";
import type { QuoteDraft } from "./port.ts";

const draft = (over: Partial<QuoteDraft> = {}): QuoteDraft => ({
  customer_id: FX.customers.abInA, title: "Corte e barba", valid_until: "2026-10-27T12:00:00Z", notes: null,
  items: [{ service_id: FX.services.corteA, description: "Corte", quantity: 1, unit_price_cents: 6000 },
    { service_id: FX.services.barbaA, description: "Barba", quantity: 1, unit_price_cents: 4000 }],
  slot: { service_id: FX.services.corteA, starts_at: "2026-10-21T13:00:00Z" }, ...over,
});
const code = async (p: Promise<unknown>) => p.then(() => "ok", (e: { code: string }) => e.code);

describe("demonstração dos orçamentos (mesmas regras do banco)", () => {
  beforeEach(() => resetDemoState());

  it("total calculado, hash por versão, link e aceite que reserva com o preço aceito", async () => {
    const port = createDemoPort();
    const link = createDemoLinkPort();
    const q = await port.create(draft(), "k-create-1");
    expect(q.current.total_cents).toBe(10000);
    expect(q.current.slot?.ends_at).toBe("2026-10-21T13:30:00.000Z");
    expect(await port.create(draft(), "k-create-1")).toEqual(q);
    const { token } = await port.send(q, "k-send-1");
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect((await port.send(q, "k-send-1")).token).toBeNull();
    const view = await link.view(token!);
    const res = await link.accept(token!, view, "k-acc-1");
    expect(res.booking?.agreed_price_cents).toBe(10000);
    expect(res.booking?.source).toBe("quote");
    expect(await link.accept(token!, view, "k-acc-2")).toEqual(res);
    expect(await code(link.decline(token!, view, "k-dec-1"))).toBe("POLICY_REJECTED");
  });

  it("revisão depois de aberto: aceite da versão vista é negado", async () => {
    const port = createDemoPort();
    const link = createDemoLinkPort();
    const q = await port.create(draft({ slot: null }), "k-c");
    const { token } = await port.send(q, "k-s");
    const old = await link.view(token!);
    const q2 = await port.revise(q, draft({ slot: null, title: "Corte" }), "k-r");
    expect(q2.current.version_no).toBe(2);
    expect(q2.current.snapshot_hash).not.toBe(old.snapshot_hash);
    expect(await code(port.revise(q, draft(), "k-r2"))).toBe("STALE_VERSION");
    expect(await code(link.accept(token!, old, "k-a"))).toBe("STALE_VERSION");
    const fresh = await link.view(token!);
    expect((await link.accept(token!, fresh, "k-a2")).booking).toBeNull();
  });

  it("dois orçamentos no mesmo horário: o segundo aceite dá SLOT_CONFLICT e fica aberto", async () => {
    const port = createDemoPort();
    const link = createDemoLinkPort();
    const a = await port.send(await port.create(draft(), "a"), "as");
    const b = await port.send(await port.create(draft({ customer_id: FX.customers.guestInA }), "b"), "bs");
    await link.accept(a.token!, await link.view(a.token!), "aa");
    expect(await code(link.accept(b.token!, await link.view(b.token!), "ba"))).toBe("SLOT_CONFLICT");
    expect((await link.view(b.token!)).status).toBe("sent");
  });

  it("custo de materiais (P30): pela ficha da versão atual; serviço sem ficha fica descoberto; não muda o orçamento", async () => {
    const port = createDemoPort();
    const q = await port.create(draft({ items: [{ service_id: FX.services.corteA, description: "Corte", quantity: 2, unit_price_cents: 6000 },
      { service_id: FX.services.barbaA, description: "Barba", quantity: 1, unit_price_cents: 4000 }] }), "m1");
    const c = await port.materialCost(q.id);
    expect(c).toMatchObject({ version_no: 1, total_cents: 16000, material_cost_cents: 800, margin_cents: 15200, covered: false });
    expect(c.lines.map((l) => l.covered)).toEqual([true, false]);
    expect((await port.get(q.id)).quote.current.total_cents).toBe(16000);
  });

  it("novo link invalida o anterior; cancelado some do link", async () => {
    const port = createDemoPort();
    const link = createDemoLinkPort();
    const q = await port.create(draft({ slot: null }), "c");
    const first = await port.send(q, "s1");
    const second = await port.send(q, "s2");
    expect(await code(link.view(first.token!))).toBe("NOT_FOUND");
    await port.cancel(q.id, "x");
    expect(await code(link.view(second.token!))).toBe("NOT_FOUND");
  });
});
