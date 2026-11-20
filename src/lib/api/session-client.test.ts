import { describe, expect, it, vi } from "vitest";
import { ContextResponse, SetupScopeOutput } from "@contracts";
import { FX } from "@contracts/fixtures.ts";
import { createSessionClient } from "./session-client.ts";

const meta = { request_id: "7a1f8a52-2b0c-4b4e-9f1e-3c0f6b5d2a10", as_of: "2026-10-20T12:00:00Z", schema_version: 1 };
const ctx = (tenant: string, name: string) => ({
  actor_user_id: FX.users.ownerA,
  tenant_id: tenant,
  role: "owner",
  tenant_name: name,
  timezone: "America/Sao_Paulo",
  currency: "BRL",
});
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function setup(responder: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => responder(url, init));
  const call = createSessionClient({
    baseUrl: "https://exemplo.supabase.co",
    publishableKey: "sb_publishable_exemplo",
    getAccessToken: async () => "jwt",
    fetch: fetchMock as unknown as typeof fetch,
  });
  return { call, fetchMock };
}
const tenantOf = (init: RequestInit) => (init.headers as Record<string, string>)["X-Tinindo-Tenant"]!;

describe("cliente da sessão", () => {
  it("/context é pedido uma vez por negócio, mesmo com leituras simultâneas", async () => {
    const { call, fetchMock } = setup((_u, init) => json(200, { data: ctx(tenantOf(init), "N"), meta }));
    const all = await Promise.all([
      call("/context", ContextResponse, { tenantId: FX.tenants.A }),
      call("/context", ContextResponse, { tenantId: FX.tenants.A }),
      call("/context", ContextResponse, { tenantId: FX.tenants.A }),
    ]);
    expect(all.map((r) => r.data.tenant_id)).toEqual([FX.tenants.A, FX.tenants.A, FX.tenants.A]);
    await call("/context", ContextResponse, { tenantId: FX.tenants.A });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("outro negócio tem a sua própria leitura; forget() limpa tudo (troca de login)", async () => {
    const { call, fetchMock } = setup((_u, init) => json(200, { data: ctx(tenantOf(init), "N"), meta }));
    const b = await call("/context", ContextResponse, { tenantId: FX.tenants.B });
    await call("/context", ContextResponse, { tenantId: FX.tenants.A });
    expect(b.data.tenant_id).toBe(FX.tenants.B);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    call.forget();
    await call("/context", ContextResponse, { tenantId: FX.tenants.A });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("falha não fica guardada: a próxima leitura vai ao servidor", async () => {
    let n = 0;
    const { call, fetchMock } = setup(() => {
      n += 1;
      if (n === 1) return json(503, { error: { code: "PROVIDER_UNAVAILABLE", message: "fora", retryable: true }, request_id: meta.request_id });
      return json(200, { data: ctx(FX.tenants.A, "N"), meta });
    });
    await expect(call("/context", ContextResponse, { tenantId: FX.tenants.A })).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    const ok = await call("/context", ContextResponse, { tenantId: FX.tenants.A });
    expect(ok.data.tenant_name).toBe("N");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("as outras operações não passam pelo cache", async () => {
    const scope = { scope: { profession: "barber", plan: "pilot", modules: [] } };
    const { call, fetchMock } = setup(() => json(200, { data: scope, meta }));
    await call("/setup/setup.scope", SetupScopeOutput, { method: "POST", tenantId: FX.tenants.A, body: {} }).catch(() => undefined);
    await call("/setup/setup.scope", SetupScopeOutput, { method: "POST", tenantId: FX.tenants.A, body: {} }).catch(() => undefined);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
