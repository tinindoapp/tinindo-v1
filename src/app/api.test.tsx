// P53 (R4/R5): um cliente de API por sessão e o contexto do negócio na sessão, lido uma vez por negócio.
import { act, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ContextResponse } from "@contracts";
import { FX, tenantA } from "@contracts/fixtures.ts";

vi.mock("./env.ts", () => ({
  appEnv: { name: "staging", demo: true, supabase: { url: "https://exemplo.supabase.co", publishableKey: "sb_publishable_exemplo" } },
}));

const { useApi, useBusinessTimezone, usePort } = await import("./api.tsx");
const { SessionProvider, useSession } = await import("./session.tsx");

const meta = { request_id: "7a1f8a52-2b0c-4b4e-9f1e-3c0f6b5d2a10", as_of: "2026-10-20T12:00:00Z", schema_version: 1 };
const memberships = [
  { tenant_id: FX.tenants.A, role: "owner", tenants: { name: "Barbearia Exemplo A" } },
  { tenant_id: FX.tenants.B, role: "staff", tenants: { name: "Studio Exemplo B" } },
];

function fakeSupabase() {
  const query = { select: () => query, eq: () => query, limit: async () => ({ data: memberships, error: null }) };
  return {
    auth: {
      getSession: async () => ({ data: { session: { user: { id: FX.users.ownerA, email: "a@b.c" }, access_token: "jwt" } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
    from: () => query,
    rpc: async () => ({ data: false, error: null }),
  } as unknown as SupabaseClient;
}

function stubFetch(timezoneOf: (tenant: string) => string) {
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    const tenant = (init.headers as Record<string, string>)["X-Tinindo-Tenant"]!;
    const data = { actor_user_id: FX.users.ownerA, tenant_id: tenant, role: tenant === FX.tenants.A ? "owner" : "staff",
      tenant_name: tenant === FX.tenants.A ? "Barbearia Exemplo A" : "Studio Exemplo B", timezone: timezoneOf(tenant), currency: "BRL" };
    return new Response(JSON.stringify({ data, meta }), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
afterEach(() => vi.unstubAllGlobals());

type Seen = { calls: unknown[] };
function Probe({ seen }: { seen: Seen }) {
  const { business, selectTenant } = useSession();
  const { call } = useApi();
  const { timezone } = useBusinessTimezone();
  useEffect(() => {
    seen.calls.push(call);
  }, [seen, call]);
  return (
    <div>
      <p>
        {business.status}:{business.status === "ready" ? `${business.business.name}|${business.business.role}` : ""}:{timezone ?? "-"}
      </p>
      <button onClick={() => selectTenant(FX.tenants.A)}>negócio A</button>
      <button onClick={() => selectTenant(FX.tenants.B)}>negócio B</button>
    </div>
  );
}

describe("contexto do negócio na sessão (R5)", () => {
  it("lê /context uma vez por negócio, com fuso e papel; trocar de negócio relê; voltar reaproveita", async () => {
    const fetchMock = stubFetch((t) => (t === FX.tenants.A ? "America/Sao_Paulo" : "America/Manaus"));
    const seen: Seen = { calls: [] };
    render(
      <SessionProvider client={fakeSupabase()}>
        <Probe seen={seen} />
      </SessionProvider>,
    );
    expect(await screen.findByText("ready:Barbearia Exemplo A|owner:America/Sao_Paulo")).toBeInTheDocument();
    act(() => screen.getByRole("button", { name: "negócio B" }).click());
    expect(await screen.findByText("ready:Studio Exemplo B|staff:America/Manaus")).toBeInTheDocument();
    act(() => screen.getByRole("button", { name: "negócio A" }).click());
    expect(await screen.findByText("ready:Barbearia Exemplo A|owner:America/Sao_Paulo")).toBeInTheDocument();
    const contextCalls = fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/functions/v1/context"));
    expect(contextCalls).toHaveLength(2);
    // Um cliente só durante toda a sessão.
    expect(new Set(seen.calls.filter(Boolean)).size).toBe(1);
  });

  it("falha na leitura: estado de erro, sem fuso inventado", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("x", { status: 503 })));
    const seen: Seen = { calls: [] };
    render(
      <SessionProvider client={fakeSupabase()}>
        <Probe seen={seen} />
      </SessionProvider>,
    );
    expect(await screen.findByText("error::-")).toBeInTheDocument();
  });

  it("as portas pedem /context pelo mesmo cliente e não vão de novo ao servidor", async () => {
    const fetchMock = stubFetch(() => "America/Sao_Paulo");
    let port: { tz(): Promise<string> } | null = null;
    const keep = (p: { tz(): Promise<string> } | null) => {
      port = p;
    };
    render(
      <SessionProvider client={fakeSupabase()}>
        <Probe seen={{ calls: [] }} />
        <PortProbe onPort={keep} />
      </SessionProvider>,
    );
    await screen.findByText(/^ready:/);
    await waitFor(() => expect(port).not.toBeNull());
    expect(await port!.tz()).toBe("America/Sao_Paulo");
    expect(await port!.tz()).toBe("America/Sao_Paulo");
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/context"))).toHaveLength(1);
  });
});

function PortProbe({ onPort }: { onPort(p: { tz(): Promise<string> } | null): void }) {
  const port = usePort({ demo: demoPort, server: serverPort });
  useEffect(() => onPort(port), [port, onPort]);
  return null;
}

const demoPort = () => ({ tz: async () => tenantA.timezone });
const serverPort = (call: NonNullable<ReturnType<typeof useApi>["call"]>, tenantId: string) => ({
  tz: async () => (await call("/context", ContextResponse, { tenantId })).data.timezone,
});
