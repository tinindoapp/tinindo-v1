// Porta de servidor da Equipe contra o registro de contratos (ver harness.ts).
import { describe, expect, it } from "vitest";
import { CustomerListOutput } from "@contracts";
import { createServerPort } from "../../../src/features/resources/serverPort.ts";
import type { TeamBooking, TeamClass } from "../../../src/features/resources/port.ts";
import { exercisePort, sampleOf, TENANT, unusedOperations } from "./harness.ts";

const ID = "00000000-0000-4000-8000-0000000000a1";
const OTHER = "00000000-0000-4000-8000-0000000000a2";
const window = { starts_at: "2026-10-20T03:00:00Z", ends_at: "2026-10-21T03:00:00Z" };
const period = { starts_at: "2026-10-01T03:00:00Z", ends_at: "2026-11-01T03:00:00Z" };
const booking = { id: ID, version: 2 } as TeamBooking;
const lesson = { id: ID, version: 5 } as TeamClass;

describe("resources · porta do servidor", () => {
  it("toda chamada bate com o registro de contratos", async () => {
    // Clientes em duas páginas: a primeira devolve cursor, a segunda encerra (o exemplo gerado nunca encerraria).
    let customerPages = 0;
    const customerPage = () => ({ ...(sampleOf(CustomerListOutput, "customer.list") as object), next_cursor: (customerPages += 1) === 1 ? "pagina-2" : null });

    const calls = await exercisePort("resources", (call) => createServerPort(call, TENANT), {
      base: async (p) => {
        const base = await p.base();
        expect(base.customers).toHaveLength(2);
      },
      list: (p) => p.list(),
      save: (p, key) => p.save({ resource_id: null, expected_version: null, kind: "professional", name: "Ana", active: true, commission_bps: 3000, agenda_linked: false }, key),
      saveRule: (p, key) => p.saveRule(ID, OTHER, null, key),
      availability: (p) => p.availability(ID, OTHER, [], window),
      book: (p, key) => p.book({ service_id: ID, customer_id: null, professional_id: OTHER, resource_ids: [], starts_at: "2026-10-20T15:00:00Z" }, key),
      cancelBooking: (p, key) => p.cancelBooking(booking, null, key),
      completeBooking: (p, key) => p.completeBooking(booking, key),
      schedule: (p) => p.schedule(window),
      createClass: (p, key) => p.createClass({ service_id: ID, professional_id: OTHER, room_id: null, title: "Pilates", starts_at: "2026-10-20T15:00:00Z", capacity: 8, seat_price_cents: null }, key),
      enroll: (p, key) => p.enroll(ID, OTHER, key),
      cancelSeat: (p, key) => p.cancelSeat(ID, 3, key),
      cancelClass: (p, key) => p.cancelClass(lesson, key),
      completeClass: (p, key) => p.completeClass(lesson, [OTHER], key),
      commissions: (p) => p.commissions(period),
      reverseCommission: (p, key) => p.reverseCommission(ID, key),
    }, { alsoReads: ["crm"], responses: { "customer.list": customerPage } });

    // A base lê o fuso, os serviços e os clientes página a página, levando o cursor recebido.
    expect(calls.base!.map((c) => c.path)).toEqual(["/context", "/crm/services?limit=100", "/crm/customers?limit=100", "/crm/customers?limit=100&cursor=pagina-2"]);
    expect(calls.cancelBooking![0]!.body).toEqual({ booking_id: ID, expected_version: 2, reason: null });
    expect(calls.cancelSeat![0]!.body).toEqual({ seat_id: ID, expected_version: 3 });
    expect(calls.completeClass![0]!.body).toEqual({ class_id: ID, expected_version: 5, attended_seat_ids: [OTHER] });
    // A tela da Equipe alcança todo o módulo.
    expect(unusedOperations("resources", calls)).toEqual([]);
  });
});
