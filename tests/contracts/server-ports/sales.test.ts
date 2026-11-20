// Portas de servidor dos Orçamentos (dono e link público) contra o registro de contratos (ver harness.ts).
import { describe, expect, it } from "vitest";
import { CustomerListOutput, type SalesQuote } from "@contracts";
import { createServerLinkPort, createServerPort } from "../../../src/features/sales/serverPort.ts";
import type { QuoteDraft, QuoteView } from "../../../src/features/sales/port.ts";
import { exercisePort, sampleOf, TENANT, unusedOperations } from "./harness.ts";

const ID = "00000000-0000-4000-8000-0000000000a1";
const OTHER = "00000000-0000-4000-8000-0000000000b2";
const TOKEN = "A".repeat(43);
const HASH = "c".repeat(64);
const draft: QuoteDraft = {
  customer_id: OTHER,
  title: "Dia da noiva",
  items: [{ service_id: ID, description: "Penteado", quantity: 1, unit_price_cents: 25000 }],
  valid_until: "2026-11-05T03:00:00Z",
  slot: { service_id: ID, starts_at: "2026-11-07T13:00:00Z" },
  notes: null,
};
const quote = { id: ID, current_version: 2, version: 7 } as SalesQuote;
const view = { version_no: 2, snapshot_hash: HASH, title: "Dia da noiva", business_name: "Salão" } as QuoteView;

/** Duas páginas de clientes: a primeira devolve cursor, a segunda encerra. */
function customerPages() {
  let page = 0;
  return () => ({ ...(sampleOf(CustomerListOutput, "customer.list") as object), next_cursor: (page += 1) === 1 ? "pagina-2" : null });
}

describe("sales · portas do servidor", () => {
  it("toda chamada bate com o registro de contratos", async () => {
    const calls = await exercisePort("sales", (call) => createServerPort(call, TENANT), {
      now: (p) => p.now(),
      base: (p) => p.base(),
      list: (p) => p.list(),
      get: (p) => p.get(ID),
      materialCost: (p) => p.materialCost(ID),
      create: (p, key) => p.create(draft, key),
      revise: (p, key) => p.revise(quote, draft, key),
      send: (p, key) => p.send(quote, key),
      cancel: (p, key) => p.cancel(ID, key),
    }, { alsoReads: ["crm", "materials"], responses: { "customer.list": customerPages() } });

    expect(calls.now).toEqual([]);
    expect(calls.create![0]!.body).toEqual(draft);
    // Revisar não troca o cliente; a versão esperada é a versão do conteúdo (current_version), não a do registro.
    const { customer_id: _customer, ...content } = draft;
    expect(calls.revise![0]!.body).toEqual({ quote_id: ID, expected_version: 2, ...content });
    expect(calls.send![0]!.body).toEqual({ quote_id: ID, expected_version: 2 });

    // Link público: sem negócio no header; aceite e recusa citam só a versão e o hash vistos.
    const link = await exercisePort("sales", (call) => createServerLinkPort(call), {
      view: (p) => p.view(TOKEN),
      accept: (p, key) => p.accept(TOKEN, view, key),
      decline: (p, key) => p.decline(TOKEN, view, key),
    }, { tenant: "none" });
    expect(link.accept![0]!.body).toEqual({ token: TOKEN, version_no: 2, snapshot_hash: HASH });
    expect(link.decline![0]!.body).toEqual({ token: TOKEN, version_no: 2, snapshot_hash: HASH });

    expect(unusedOperations("sales", { ...calls, ...link })).toEqual([]);
  });
});
