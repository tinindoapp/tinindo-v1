// Porta de servidor de Materiais contra o registro de contratos (ver harness.ts).
import { describe, expect, it } from "vitest";
import { createServerPort } from "../../../src/features/materials/serverPort.ts";
import type { MaterialConsumption, MaterialItem, MaterialPurchase } from "../../../src/features/materials/port.ts";
import { exercisePort, TENANT, unusedOperations } from "./harness.ts";

const ID = "00000000-0000-4000-8000-0000000000a1";
const period = { starts_at: "2026-10-01T03:00:00Z", ends_at: "2026-11-01T03:00:00Z" };
const item = { id: ID, version: 3 } as MaterialItem;
const purchase = { id: ID, version: 1 } as MaterialPurchase;
const consumption = { id: ID, version: 2 } as MaterialConsumption;

describe("materials · porta do servidor", () => {
  it("toda chamada bate com o registro de contratos", async () => {
    const calls = await exercisePort("materials", (call) => createServerPort(call, TENANT), {
      base: (p) => p.base(),
      list: (p) => p.list(),
      saveItem: (p, key) => p.saveItem({ name: "Shampoo", kind: "consumable", unit: "ml", min_qty: null }, key),
      saveUsage: (p, key) => p.saveUsage(ID, ID, 0.5, key),
      purchase: (p, key) => p.purchase("Distribuidora", "2026-10-20T15:00:00Z", [{ item_id: ID, quantity: 2, total_cents: 5000 }], true, key),
      reversePurchase: (p, key) => p.reversePurchase(purchase, key),
      adjust: (p, key) => p.adjust(item, 10, "Contagem do mês", key),
      consume: (p, key) => p.consume(ID, null, key),
      reverseConsumption: (p, key) => p.reverseConsumption(consumption, key),
      purchases: (p) => p.purchases(period),
      bookings: (p) => p.bookings(period),
      margin: (p) => p.margin(period),
    }, { alsoReads: ["crm"] });

    expect(calls.adjust![0]!.body).toEqual({ item_id: ID, expected_version: 3, counted: 10, reason: "Contagem do mês" });
    expect(calls.reversePurchase![0]!.body).toEqual({ purchase_id: ID, expected_version: 1 });
    // Operações do contrato que a tela de Materiais ainda não chama.
    expect(unusedOperations("materials", calls)).toEqual(["materials.quote_cost"]);
  });
});
