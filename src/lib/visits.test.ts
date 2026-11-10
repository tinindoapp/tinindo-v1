import { describe, expect, it, vi } from "vitest";
import { agoText, daysSince, demoVisitSummary, isLapsed, readVisitSummary, summarizeVisits, visitWindows } from "./visits.ts";

const TZ = "America/Sao_Paulo";
const now = new Date("2026-10-20T12:00:00Z"); // terça 20/10, 09:00 em São Paulo

describe("retorno do cliente pela agenda (P49)", () => {
  it("última visita é o concluído mais recente; próximo é o confirmado ou reservado mais cedo a partir de agora", () => {
    const s = summarizeVisits(
      [
        { customer_id: "a", starts_at: "2026-09-01T13:00:00Z", status: "completed" },
        { customer_id: "a", starts_at: "2026-10-06T13:00:00Z", status: "completed" },
        { customer_id: "a", starts_at: "2026-10-13T13:00:00Z", status: "no_show" },
        { customer_id: "a", starts_at: "2026-10-30T13:00:00Z", status: "confirmed" },
        { customer_id: "a", starts_at: "2026-10-27T13:00:00Z", status: "held" },
        { customer_id: "a", starts_at: "2026-10-22T13:00:00Z", status: "cancelled" },
        { customer_id: "b", starts_at: "2026-10-19T13:00:00Z", status: "confirmed" },
        { customer_id: null, starts_at: "2026-10-01T13:00:00Z", status: "completed" },
      ],
      now,
      "2026-04-23T00:00:00Z",
    );
    expect(s.byCustomer.a).toEqual({ last_visit_at: "2026-10-06T13:00:00Z", next_at: "2026-10-27T13:00:00Z" });
    // Confirmado que já passou não é visita nem próximo (falta marcar Atendido).
    expect(s.byCustomer.b).toEqual({ last_visit_at: null, next_at: null });
    expect(Object.keys(s.byCustomer)).toEqual(["a", "b"]);
  });

  it("dias contados pela data local do negócio", () => {
    expect(daysSince("2026-10-20T11:00:00Z", now, TZ)).toBe(0);
    // 19/10 às 23:30 em São Paulo (20/10 02:30 UTC) é ontem.
    expect(daysSince("2026-10-20T02:30:00Z", now, TZ)).toBe(1);
    expect(daysSince("2026-09-20T13:00:00Z", now, TZ)).toBe(30);
    expect(agoText(0)).toBe("hoje");
    expect(agoText(1)).toBe("há 1 dia");
    expect(agoText(30)).toBe("há 30 dias");
  });

  it("não volta: veio, a última há 30 dias ou mais e sem horário marcado", () => {
    expect(isLapsed({ last_visit_at: "2026-09-20T13:00:00Z", next_at: null }, now, TZ)).toBe(true);
    expect(isLapsed({ last_visit_at: "2026-09-21T13:00:00Z", next_at: null }, now, TZ)).toBe(false);
    expect(isLapsed({ last_visit_at: "2026-07-01T13:00:00Z", next_at: "2026-10-27T13:00:00Z" }, now, TZ)).toBe(false);
    expect(isLapsed({ last_visit_at: null, next_at: null }, now, TZ)).toBe(false);
    expect(isLapsed(undefined, now, TZ)).toBe(false);
  });

  it("lê a agenda em janelas de 60 dias (o contrato aceita até 62), de 180 dias atrás a 60 à frente, com páginas", async () => {
    const w = visitWindows(now, TZ);
    expect(w).toEqual([
      { starts_at: "2026-04-23T00:00:00Z", ends_at: "2026-06-22T00:00:00Z" },
      { starts_at: "2026-06-22T00:00:00Z", ends_at: "2026-08-21T00:00:00Z" },
      { starts_at: "2026-08-21T00:00:00Z", ends_at: "2026-10-20T00:00:00Z" },
      { starts_at: "2026-10-20T00:00:00Z", ends_at: "2026-12-19T00:00:00Z" },
    ]);
    const booking = (id: string, starts_at: string, status: string) => ({
      id, tenant_id: "10000000-0000-4000-8000-000000000001", resource_id: "20000000-0000-4000-8000-000000000001", customer_id: "30000000-0000-4000-8000-000000000001",
      service_id: "40000000-0000-4000-8000-000000000001", starts_at, ends_at: starts_at, status, status_reason: null, hold_expires_at: null, price_quote_id: null,
      agreed_price_cents: 6000, source: "owner", version: 1,
    });
    const call = vi.fn(async (path: string, _schema: unknown, opts: { body: { window: { starts_at: string }; cursor?: string } }) => {
      expect(path).toBe("/scheduling/booking.list");
      const third = opts.body.window.starts_at.startsWith("2026-08-21");
      if (third && !opts.body.cursor) return { data: { bookings: [booking("50000000-0000-4000-8000-000000000001", "2026-09-01T13:00:00Z", "completed")], next_cursor: "p2" } };
      if (third) return { data: { bookings: [booking("50000000-0000-4000-8000-000000000002", "2026-09-10T13:00:00Z", "completed")], next_cursor: null } };
      return { data: { bookings: [], next_cursor: null } };
    });
    const s = await readVisitSummary(call as never, "10000000-0000-4000-8000-000000000001", TZ, now);
    expect(call).toHaveBeenCalledTimes(5);
    expect(s).toEqual({ since: "2026-04-23T00:00:00Z", complete: true, byCustomer: { "30000000-0000-4000-8000-000000000001": { last_visit_at: "2026-09-10T13:00:00Z", next_at: null } } });
  });

  it("demonstração usa a base de exemplo única", async () => {
    const s = await demoVisitSummary();
    expect(s.complete).toBe(true);
    expect(Object.keys(s.byCustomer).length).toBeGreaterThan(0);
  });
});
