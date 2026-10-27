// P30 pelos handlers com o banco real: itens → ficha do corte → compra com despesa no Caixa (P07) → atendimento
// concluído consome pela ficha (custo médio) → repetir com outra chave é recusado → estorno devolve exato → registrar de
// novo → margem real com cobertura → custo do orçamento (P11) → estorno da compra e da despesa. SEC: outro dono e cliente.
import { afterAll, describe, expect, it } from "vitest";
import { FinanceLedgerOutput, MaterialBookingsOutput, MaterialConsumptionOutput, MaterialItemOutput, MaterialListOutput, MaterialMarginOutput,
  MaterialMovementsOutput, MaterialPurchaseOutput, MaterialQuoteCostOutput, MaterialUsageOutput, SalesQuoteOutput } from "@contracts";
import { call, fails, FX, iso, newKey, ok, pool, sql, T, U } from "./harness.ts";

const owner = { as: U.ownerA, tenant: T.A };
afterAll(() => pool.end());
const period = () => ({ starts_at: iso(new Date(Date.now() - 7 * 86_400_000)), ends_at: iso(new Date(Date.now() + 60_000)) });

describe("P30 · materiais e custos pelos handlers", () => {
  const id: Record<string, string> = {};
  let bookingId = "";
  let purchaseId = "";
  let expenseId = "";

  it("0 · itens, ficha do corte e compra com despesa no Caixa", async () => {
    id.cera = (await ok(MaterialItemOutput, "materials", "materials.item_save", { ...owner, key: true, body: { name: "Cera modeladora (int)", unit: "g", min_qty: 100 } })).item.id;
    id.navalha = (await ok(MaterialItemOutput, "materials", "materials.item_save", { ...owner, key: true, body: { name: "Lâmina (int)", unit: "un" } })).item.id;
    await ok(MaterialUsageOutput, "materials", "materials.usage_save", { ...owner, key: true, body: { service_id: FX.services.corteA, item_id: id.cera, quantity: 5 } });
    const u = await ok(MaterialUsageOutput, "materials", "materials.usage_save", { ...owner, key: true, body: { service_id: FX.services.corteA, item_id: id.navalha, quantity: 1 } });
    expect(u.usage.filter((x) => x.service_id === FX.services.corteA)).toHaveLength(2);
    const p = await ok(MaterialPurchaseOutput, "materials", "materials.purchase", { ...owner, key: true, body: { supplier: "Fornecedor de teste", purchased_at: iso(new Date()),
      lines: [{ item_id: id.cera, quantity: 500, total_cents: 4000 }, { item_id: id.navalha, quantity: 20, total_cents: 1000 }] } });
    expect(p.purchase).toMatchObject({ total_cents: 5000, status: "recorded" });
    purchaseId = p.purchase.id;
    expenseId = p.purchase.expense_id!;
    const ledger = await ok(FinanceLedgerOutput, "finance", "finance.ledger", { ...owner, body: { period: period() } });
    expect(ledger.expenses.find((e) => e.id === expenseId)).toMatchObject({ amount_cents: 5000, category: "supplies" });
    const list = await ok(MaterialListOutput, "materials", "materials.list", { ...owner, body: {} });
    expect(list.items.find((i) => i.id === id.cera)).toMatchObject({ on_hand: 500, stock_value_cents: 4000, unit_cost_cents: 8, low_stock: false });
  });

  it("1 · atendimento concluído consome pela ficha; outro consumo é recusado; estorno devolve exato; registrar de novo", async () => {
    const [{ id: b }] = await sql<{ id: string }>(`insert into public.bookings (tenant_id, resource_id, customer_id, service_id, starts_at, ends_at, occupied_range,
      blocks_capacity, status, agreed_price_cents, source) values ($1, $2, $3, $4, now() - interval '50 hours', now() - interval '50 hours' + interval '30 minutes',
      tstzrange(now() - interval '50 hours', now() - interval '50 hours' + interval '40 minutes', '[)'), true, 'completed', 6000, 'owner') returning id`,
      [T.A, FX.resources.A, FX.customers.abInA, FX.services.corteA]);
    bookingId = b;
    const key = newKey();
    const c = await ok(MaterialConsumptionOutput, "materials", "materials.consume", { ...owner, key, body: { booking_id: bookingId } });
    expect(c.consumption).toMatchObject({ status: "active", source: "usage", cost_cents: 90 });
    expect((await ok(MaterialConsumptionOutput, "materials", "materials.consume", { ...owner, key, body: { booking_id: bookingId } })).consumption.id).toBe(c.consumption.id);
    await fails("materials", "materials.consume", { ...owner, key: true, body: { booking_id: bookingId } }, "POLICY_REJECTED", "consumed");
    const r = await ok(MaterialConsumptionOutput, "materials", "materials.consume_reverse", { ...owner, key: true, body: { consumption_id: c.consumption.id, expected_version: c.consumption.version } });
    expect(r.consumption.status).toBe("reversed");
    await fails("materials", "materials.consume_reverse", { ...owner, key: true, body: { consumption_id: c.consumption.id, expected_version: r.consumption.version } }, "POLICY_REJECTED", "reversed");
    const list = await ok(MaterialListOutput, "materials", "materials.list", { ...owner, body: {} });
    expect(list.items.find((i) => i.id === id.cera)).toMatchObject({ on_hand: 500, stock_value_cents: 4000 });
    const again = await ok(MaterialConsumptionOutput, "materials", "materials.consume", { ...owner, key: true,
      body: { booking_id: bookingId, lines: [{ item_id: id.cera, quantity: 7.5 }] } });
    expect(again.consumption).toMatchObject({ source: "manual", cost_cents: 60 });
    const bk = await ok(MaterialBookingsOutput, "materials", "materials.bookings", { ...owner, body: { period: period() } });
    expect(bk.bookings.find((x) => x.booking_id === bookingId)?.consumption?.id).toBe(again.consumption.id);
  });

  it("2 · margem real só sobre atendimentos com consumo; cobertura explícita", async () => {
    const m = await ok(MaterialMarginOutput, "materials", "materials.margin", { ...owner, body: { period: period() } });
    const corte = m.services.find((s) => s.service_id === FX.services.corteA)!;
    expect(corte.with_materials).toBeGreaterThanOrEqual(1);
    expect(corte.completed).toBeGreaterThanOrEqual(corte.with_materials);
    expect(corte.margin_cents).toBe(corte.covered_revenue_cents - corte.material_cost_cents);
    expect(corte.material_cost_cents).toBeGreaterThanOrEqual(60);
  });

  it("3 · custo estimado do orçamento (P11) pela ficha e pelo custo médio", async () => {
    const q = await ok(SalesQuoteOutput, "sales", "quote.create", { ...owner, key: true, body: { customer_id: FX.customers.abInA, title: "Pacote formatura",
      items: [{ service_id: FX.services.corteA, description: "Corte", quantity: 3, unit_price_cents: 6000 }], valid_until: iso(new Date(Date.now() + 7 * 86_400_000)) } });
    const cost = await ok(MaterialQuoteCostOutput, "materials", "materials.quote_cost", { ...owner, body: { quote_id: q.quote.id } });
    expect(cost).toMatchObject({ total_cents: 18000, covered: true });
    expect(cost.material_cost_cents).toBe(3 * (5 * 8 + 50));
    expect(cost.margin_cents).toBe(18000 - cost.material_cost_cents);
  });

  it("4 · estorno da compra: recusado com estoque já usado; depois do estorno do uso, sai pelo custo médio e a despesa recebe o estorno no Caixa, uma vez", async () => {
    const mv = await ok(MaterialMovementsOutput, "materials", "materials.movements", { ...owner, body: { item_id: null, period: period() } });
    const p = mv.purchases.find((x) => x.id === purchaseId)!;
    // Parte da cera já foi usada: a compra não sai do estoque enquanto o consumo existir.
    await fails("materials", "materials.purchase_reverse", { ...owner, key: true, body: { purchase_id: purchaseId, expected_version: p.version } }, "POLICY_REJECTED", "stock");
    const bk = await ok(MaterialBookingsOutput, "materials", "materials.bookings", { ...owner, body: { period: period() } });
    const c = bk.bookings.find((x) => x.booking_id === bookingId)!.consumption!;
    await ok(MaterialConsumptionOutput, "materials", "materials.consume_reverse", { ...owner, key: true, body: { consumption_id: c.id, expected_version: c.version } });
    const r = await ok(MaterialPurchaseOutput, "materials", "materials.purchase_reverse", { ...owner, key: true, body: { purchase_id: purchaseId, expected_version: p.version } });
    expect(r.purchase.status).toBe("reversed");
    await fails("materials", "materials.purchase_reverse", { ...owner, key: true, body: { purchase_id: purchaseId, expected_version: r.purchase.version } }, "POLICY_REJECTED", "status");
    const ledger = await ok(FinanceLedgerOutput, "finance", "finance.ledger", { ...owner, body: { period: period() } });
    expect(ledger.expenses.filter((e) => e.reversal_of === expenseId)).toHaveLength(1);
    const list = await ok(MaterialListOutput, "materials", "materials.list", { ...owner, body: {} });
    expect(list.items.filter((i) => i.id === id.navalha || i.id === id.cera).map((i) => [i.on_hand, i.stock_value_cents])).toEqual([[0, 0], [0, 0]]);
  });

  it("SEC · outro dono e cliente com login não leem nem movem; comando sem chave é recusado", async () => {
    await fails("materials", "materials.list", { as: U.ownerB, tenant: T.A, body: {} }, "FORBIDDEN");
    await fails("materials", "materials.consume", { as: U.ownerB, tenant: T.A, key: true, body: { booking_id: bookingId } }, "FORBIDDEN");
    await fails("materials", "materials.margin", { as: U.customerAB, tenant: T.A, body: { period: period() } }, "FORBIDDEN");
    await fails("materials", "materials.consume", { as: U.ownerB, tenant: T.B, key: true, body: { booking_id: bookingId } }, "NOT_FOUND", "booking_id");
    const noKey = await call("materials", "materials.purchase", { ...owner, body: { purchased_at: iso(new Date()), lines: [{ item_id: id.cera, quantity: 1, total_cents: 1 }] } });
    expect(noKey.error?.field).toBe("idempotency_key");
  });
});
