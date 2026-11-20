// Porta de servidor de Clientes (`createServerCrmApi`) contra o registro de contratos (ver harness.ts).
import { describe, expect, it } from "vitest";
import { BookingListOutput, ContextResponse } from "@contracts";
import { createServerCrmApi } from "../../../src/features/crm/api.ts";
import { exercisePort, sampleOf, TENANT, unusedOperations } from "./harness.ts";

const ID = "00000000-0000-4000-8000-0000000000a1";
const build = (call: never) => createServerCrmApi({ call, tenantId: TENANT, readProfession: async () => "barber" });

// As contas de visita usam o fuso do contexto: o exemplo gerado ("x") não é um fuso de verdade.
const context = { ...(sampleOf(ContextResponse, "context") as object), timezone: "America/Sao_Paulo" };
/** Agenda em duas páginas: sem cursor devolve um; com cursor encerra. */
const bookingPages = (body: unknown) => ({
  ...(sampleOf(BookingListOutput, "booking.list") as object),
  next_cursor: (body as { cursor?: string }).cursor ? null : "pagina-2",
});

describe("crm · porta do servidor", () => {
  it("toda chamada bate com o registro de contratos", async () => {
    const calls = await exercisePort("crm", (call) => build(call), {
      profession: (p) => p.profession(),
      getCustomer: (p) => p.getCustomer(ID),
      upsertCustomer: (p, key) => p.upsertCustomer({ name: "Ana", phone: "+5511988887777", email: null, declared_source: "referral" }, key),
      listCustomers: (p) => p.listCustomers({ q: "ana", include_archived: true, cursor: "pagina-2", limit: 20 }),
      visitSummary: (p) => p.visitSummary(),
      customerHistory: (p) => p.customerHistory(ID),
      archiveCustomer: (p, key) => p.archiveCustomer({ customer_id: ID, expected_version: 2, archived: true }, key),
      listServices: (p) => p.listServices({ include_inactive: true }),
      saveService: (p, key) => p.saveService({ name: "Corte", duration_min: 30, base_price_cents: 5000, min_price_cents: 4000 }, key),
      importPreview: (p) => p.importPreview([{ line: 2, name: "Ana", phone: "+5511988887777", email: null }]),
      importCustomers: (p, key) => p.importCustomers([{ line: 2, name: "Ana", phone: "+5511988887777", email: null, on_duplicate: "create" }], key),
    }, {
      alsoReads: ["scheduling"],
      responses: { context, "booking.list": bookingPages, "booking.list_by_customer": bookingPages },
    });

    expect(calls.profession).toEqual([]);
    expect(calls.listCustomers![0]!.path).toBe("/crm/customers?q=ana&include_archived=true&cursor=pagina-2&limit=20");
    // Filtro vazio não vira parâmetro.
    expect(calls.listServices![0]!.path).toBe("/crm/services?include_inactive=true");
    // Histórico: a segunda página leva o cursor da primeira.
    const history = calls.customerHistory!.filter((c) => c.operation === "booking.list_by_customer").map((c) => c.body);
    expect(history).toEqual([{ customer_id: ID, cursor: undefined, limit: 100 }, { customer_id: ID, cursor: "pagina-2", limit: 100 }]);
    // Importação: a porta embrulha as linhas em `rows`.
    expect(calls.importCustomers![0]!.body).toEqual({ rows: [{ line: 2, name: "Ana", phone: "+5511988887777", email: null, on_duplicate: "create" }] });
    expect(calls.getCustomer![0]!.path).toBe(`/crm/customer.get?customer_id=${ID}`);
    // declared_source chega ao corpo: o registro usa o schema do CRM, que não descarta a chave (recado #111).
    expect(calls.upsertCustomer![0]!.body).toMatchObject({ declared_source: "referral" });
    expect(unusedOperations("crm", calls)).toEqual([]);
  });
});
