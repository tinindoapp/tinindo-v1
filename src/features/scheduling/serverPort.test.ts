import { describe, expect, it, vi } from "vitest";
import { FX, bookingsA } from "@contracts/fixtures.ts";
import { createApiClient } from "../../lib/api/client.ts";
import { createServerPort } from "./serverPort.ts";

const RID = "7a1f8a52-2b0c-4b4e-9f1e-3c0f6b5d2a10";
const meta = { request_id: RID, as_of: "2026-10-20T12:00:00Z", schema_version: 1 };
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function port(response: Response) {
  const fetchMock = vi.fn(async () => response);
  const call = createApiClient({
    baseUrl: "https://exemplo.supabase.co",
    publishableKey: "sb_publishable_exemplo",
    getAccessToken: async () => "jwt",
    fetch: fetchMock as unknown as typeof fetch,
  });
  return { port: createServerPort(call, FX.tenants.A), fetchMock };
}

const input = {
  booking_id: bookingsA[0]!.id,
  expected_version: 1,
  reason: "Cliente pediu",
};

describe("porta do servidor (contrato v1)", () => {
  it("comando vai para a função do módulo com Idempotency-Key no header, não no corpo", async () => {
    const { port: p, fetchMock } = port(json(200, { data: { booking: { ...bookingsA[0], status: "cancelled", version: 2 } }, meta }));
    const out = await p.cancel(input, "chave-0000000000000001");
    expect(out.status).toBe("cancelled");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://exemplo.supabase.co/functions/v1/scheduling/booking.cancel");
    expect(init.method).toBe("POST");
    const h = init.headers as Record<string, string>;
    expect(h["Idempotency-Key"]).toBe("chave-0000000000000001");
    expect(h["X-Tinindo-Tenant"]).toBe(FX.tenants.A);
    expect(JSON.parse(init.body as string)).toEqual(input);
  });

  it("409 do servidor chega tipado para a tela explicar", async () => {
    const { port: p } = port(
      json(409, { error: { code: "SLOT_CONFLICT", message: "Ocupado.", retryable: false }, request_id: RID }),
    );
    await expect(
      p.reschedule({ booking_id: input.booking_id, expected_version: 1, slot: { starts_at: "2026-10-20T15:00:00-03:00", ends_at: "2026-10-20T15:30:00-03:00" }, quote_id: null }, "chave-0000000000000002"),
    ).rejects.toMatchObject({ code: "SLOT_CONFLICT", status: 409 });
  });

  it("resposta fora do contrato não vira dado", async () => {
    const { port: p } = port(json(200, { data: { booking: { ...bookingsA[0], status: "pago" } }, meta }));
    await expect(p.complete({ booking_id: input.booking_id, expected_version: 1 }, "chave-0000000000000003")).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
    });
  });

  it("lista atendimentos seguindo o cursor do servidor até o fim", async () => {
    const page1 = json(200, { data: { bookings: [bookingsA[0]], next_cursor: "c1" }, meta });
    const page2 = json(200, { data: { bookings: [bookingsA[1]], next_cursor: null }, meta });
    const fetchMock = vi.fn().mockResolvedValueOnce(page1).mockResolvedValueOnce(page2);
    const call = createApiClient({
      baseUrl: "https://exemplo.supabase.co", publishableKey: "pk", getAccessToken: async () => "jwt",
      fetch: fetchMock as unknown as typeof fetch,
    });
    const window = { starts_at: "2026-10-20T00:00:00-03:00", ends_at: "2026-10-21T00:00:00-03:00" };
    const out = await createServerPort(call, FX.tenants.A).listBookings(window);
    expect(out.map((b) => b.id)).toEqual([bookingsA[0]!.id, bookingsA[1]!.id]);
    const bodies = fetchMock.mock.calls.map((c) => JSON.parse((c as unknown as [string, RequestInit])[1].body as string));
    expect(bodies[0]).toMatchObject({ window, limit: 100 });
    expect(bodies[1]).toMatchObject({ cursor: "c1" });
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toMatch(/\/scheduling\/booking\.list$/);
  });

  it("contexto da agenda junta o negócio (context) e o recurso/fuso do motor (schedule.settings)", async () => {
    const ctx = { actor_user_id: FX.users.ownerA, tenant_id: FX.tenants.A, role: "owner", tenant_name: "Barbearia", timezone: "America/Sao_Paulo", currency: "BRL" };
    const settings = { resource_id: FX.resources.A, resource_version: 3, timezone: "America/Sao_Paulo", rules: [] };
    const fetchMock = vi.fn(async (url: string) =>
      json(200, { data: url.endsWith("/context") ? ctx : settings, meta }),
    );
    const call = createApiClient({
      baseUrl: "https://exemplo.supabase.co", publishableKey: "pk", getAccessToken: async () => "jwt",
      fetch: fetchMock as unknown as typeof fetch,
    });
    expect(await createServerPort(call, FX.tenants.A).context()).toEqual({
      tenantId: FX.tenants.A, tenantName: "Barbearia", timezone: "America/Sao_Paulo", resourceId: FX.resources.A,
    });
  });

  it("cotação vem do módulo de preços e é validada no contrato", async () => {
    const quote = { quote_id: bookingsA[0]!.id, service_id: FX.services.corteA, resource_id: FX.resources.A,
      slot: { starts_at: "2026-10-27T18:00:00Z", ends_at: "2026-10-27T18:30:00Z" }, currency: "BRL", base_price_cents: 6000,
      final_price_cents: 5100, rule_version: 3, reason_code: "OFF_PEAK_APPROVED", expires_at: "2026-10-27T12:10:00Z" };
    const { port: p, fetchMock } = port(json(200, { data: quote, meta }));
    expect(await p.quote({ service_id: FX.services.corteA, resource_id: FX.resources.A, slot: quote.slot })).toMatchObject({ final_price_cents: 5100 });
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toMatch(/\/pricing\/pricing\.quote$/);
  });

  it("confirmar reserva e falta vão para as rotas do motor, com chave de idempotência", async () => {
    const confirmed = { ...bookingsA[3], status: "confirmed", hold_expires_at: null, agreed_price_cents: 6000, version: 2 };
    const a = port(json(200, { data: { booking: confirmed }, meta }));
    expect((await a.port.confirm({ booking_id: bookingsA[3]!.id, expected_version: 1 }, "chave-0000000000000010")).status).toBe("confirmed");
    const [url1, init1] = a.fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url1).toMatch(/\/scheduling\/booking\.confirm$/);
    expect((init1.headers as Record<string, string>)["Idempotency-Key"]).toBe("chave-0000000000000010");

    const b = port(json(200, { data: { booking: { ...bookingsA[0], status: "no_show", version: 2 } }, meta }));
    const noShow = { booking_id: bookingsA[0]!.id, expected_version: 1, reason: "Cliente não compareceu", revert: false };
    expect((await b.port.noShow(noShow, "chave-0000000000000011")).status).toBe("no_show");
    const [url2, init2] = b.fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url2).toMatch(/\/scheduling\/booking\.no_show$/);
    expect(JSON.parse(init2.body as string)).toEqual(noShow);
  });

  it("lista de espera é lida da função do módulo (waitlist.list), só as entradas", async () => {
    const entry = { id: bookingsA[0]!.id, tenant_id: FX.tenants.A, customer_id: FX.customers.abInA, service_id: FX.services.corteA,
      status: "active", joined_at: "2026-10-18T13:00:00Z", valid_until: "2026-11-18T13:00:00Z",
      acceptable_windows: [{ weekday: 3, local_start: "09:00", local_end: "19:00" }], version: 1 };
    const { port: p, fetchMock } = port(json(200, { data: { entries: [entry], candidates: [], offers: [] }, meta }));
    expect(await p.waitlistEntries()).toEqual([entry]);
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toMatch(/\/waitlist\/waitlist\.list$/);
  });
});
