// Porta de servidor do Caixa contra o registro de contratos (ver harness.ts).
import { describe, expect, it } from "vitest";
import { CustomerListOutput } from "@contracts";
import { createServerPort } from "../../../src/features/finance/serverPort.ts";
import { exercisePort, sampleOf, TENANT, unusedOperations } from "./harness.ts";

const ID = "00000000-0000-4000-8000-0000000000a1";
const period = { starts_at: "2026-10-01T03:00:00Z", ends_at: "2026-11-01T03:00:00Z" };
const AT = "2026-10-20T15:00:00Z";

/** Duas páginas de clientes: a primeira devolve cursor, a segunda encerra. */
function customerPages() {
  let page = 0;
  return () => ({ ...(sampleOf(CustomerListOutput, "customer.list") as object), next_cursor: (page += 1) === 1 ? "pagina-2" : null });
}

describe("finance · porta do servidor", () => {
  it("toda chamada bate com o registro de contratos", async () => {
    const calls = await exercisePort("finance", (call) => createServerPort(call, TENANT), {
      now: (p) => p.now(),
      base: (p) => p.base(),
      summary: (p) => p.summary(period, "America/Sao_Paulo"),
      ledger: (p) => p.ledger(period),
      uncharged: (p) => p.uncharged(period),
      packages: (p) => p.packages(),
      createReceivable: (p, key) => p.createReceivable({ customer_id: ID, description: "Corte avulso", amount_cents: 5000, due_at: null }, key),
      chargeBooking: (p, key) => p.chargeBooking({ booking_id: ID }, key),
      cancelReceivable: (p, key) => p.cancelReceivable({ receivable_id: ID, expected_version: 2 }, key),
      recordPayment: (p, key) => p.recordPayment({ receivable_id: ID, amount_cents: 5000, method: "pix", received_at: AT }, key),
      reversePayment: (p, key) => p.reversePayment({ payment_id: ID, reason: "Lançado em dobro" }, key),
      recordExpense: (p, key) => p.recordExpense({ amount_cents: 1200, paid_at: AT, category: "supplies", description: "Lâminas" }, key),
      reverseExpense: (p, key) => p.reverseExpense({ expense_id: ID }, key),
      sellPackage: (p, key) => p.sellPackage({ customer_id: ID, service_id: ID, credits: 4, total_price_cents: 16000 }, key),
      consumePackage: (p, key) => p.consumePackage({ package_id: ID, booking_id: ID, event_id: ID }, key),
      reversePackage: (p, key) => p.reversePackage({ entry_id: ID, reason: "Débito indevido" }, key),
    }, { alsoReads: ["crm"], responses: { "customer.list": customerPages() } });

    expect(calls.now).toEqual([]);
    // A base lê serviços inativos e clientes arquivados, e segue o cursor até acabar.
    expect(calls.base!.map((c) => c.path)).toEqual([
      "/context",
      "/crm/services?limit=100&include_inactive=true",
      "/crm/customers?limit=100&include_archived=true",
      "/crm/customers?limit=100&include_archived=true&cursor=pagina-2",
    ]);
    expect(calls.summary![0]!.body).toEqual({ period, timezone: "America/Sao_Paulo" });
    expect(calls.cancelReceivable![0]!.body).toEqual({ receivable_id: ID, expected_version: 2 });
    expect(unusedOperations("finance", calls)).toEqual([]);
  });
});
