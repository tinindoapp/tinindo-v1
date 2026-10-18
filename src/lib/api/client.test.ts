import { describe, expect, it, vi } from "vitest";
import { ContextResponse } from "@contracts";
import { FX } from "@contracts/fixtures.ts";
import { ApiError, createApiClient } from "./client.ts";

const RID = "7a1f8a52-2b0c-4b4e-9f1e-3c0f6b5d2a10";
const data = {
  actor_user_id: FX.users.ownerA,
  tenant_id: FX.tenants.A,
  role: "owner",
  tenant_name: "Barbearia Exemplo A",
  timezone: "America/Sao_Paulo",
  currency: "BRL",
};
const meta = { request_id: RID, as_of: "2026-10-20T12:00:00Z", schema_version: 1 };

function client(response: Response | Error) {
  const fetchMock = vi.fn(async () => {
    if (response instanceof Error) throw response;
    return response;
  });
  const call = createApiClient({
    baseUrl: "https://exemplo.supabase.co/",
    publishableKey: "sb_publishable_exemplo",
    getAccessToken: async () => "jwt-usuario",
    fetch: fetchMock as unknown as typeof fetch,
  });
  return { call, fetchMock };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("cliente de API", () => {
  it("envia token, tenant, idempotência e valida o envelope de sucesso", async () => {
    const { call, fetchMock } = client(json(200, { data, meta }));
    const out = await call("/context", ContextResponse, { tenantId: FX.tenants.A, idempotencyKey: RID });
    expect(out.data.tenant_name).toBe("Barbearia Exemplo A");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://exemplo.supabase.co/functions/v1/context");
    const h = init.headers as Record<string, string>;
    expect(h.Authorization).toBe("Bearer jwt-usuario");
    expect(h["X-Tinindo-Tenant"]).toBe(FX.tenants.A);
    expect(h["Idempotency-Key"]).toBe(RID);
  });

  it("converte envelope de erro em ApiError tipado", async () => {
    const { call } = client(
      json(409, { error: { code: "SLOT_CONFLICT", message: "Horário ocupado.", retryable: false }, request_id: RID }),
    );
    await expect(call("/context", ContextResponse)).rejects.toMatchObject({
      code: "SLOT_CONFLICT",
      status: 409,
      requestId: RID,
      retryable: false,
    });
  });

  it("resposta 200 fora do contrato vira erro, não dado", async () => {
    const { call } = client(json(200, { data: { ...data, role: "superadmin" }, meta }));
    await expect(call("/context", ContextResponse)).rejects.toBeInstanceOf(ApiError);
  });

  it("falha de rede vira PROVIDER_UNAVAILABLE retryable", async () => {
    const { call } = client(new TypeError("Failed to fetch"));
    await expect(call("/context", ContextResponse)).rejects.toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
      retryable: true,
    });
  });
});
