import { describe, expect, it, vi } from "vitest";
import { ErrorEnvelope, PublicProfile, ReferralLink, successEnvelope } from "../_shared/contracts/index.ts";
import { FX } from "../_shared/contracts/fixtures.ts";
import { createNetworkHandler, type NetworkDeps, requestHash } from "./handler.ts";
import { OwnerProfileOutput, ReferralInspectOutput } from "./schemas.ts";

const ORIGIN = "http://localhost:5173";
const APP = "https://app.exemplo.test";
const TOKEN = "a".repeat(43); // formato do token opaco, valor sintético
const IDEM = "idem-000000000000001";

const profileRow = {
  slug: "barbearia-a",
  category: "barber",
  area: "Centro",
  public_fields: ["area", "booking_link", "display_name"],
  values: { display_name: "Barbearia Exemplo A" },
  published_at: "2026-10-20T12:00:00.123456+00:00",
  reputation: { identity_verified: false, reviews_count: 0 },
  version: 2,
};

function setup(rpc: NetworkDeps["rpc"], extra: Partial<NetworkDeps> = {}) {
  const log = vi.fn();
  const handler = createNetworkHandler({
    rpc,
    publicAppUrl: APP,
    allowedOrigins: [ORIGIN],
    clock: { now: () => new Date("2026-10-20T12:00:00Z") },
    log,
    ...extra,
  });
  return { handler, log };
}

const req = (op: string, init: { method?: string; headers?: Record<string, string>; body?: unknown; query?: string } = {}) =>
  new Request(`http://edge/network/${op}${init.query ?? ""}`, {
    method: init.method ?? "POST",
    headers: { Origin: ORIGIN, ...(init.headers ?? {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

const owner = { Authorization: "Bearer user-jwt", "X-Tinindo-Tenant": FX.tenants.A, "Idempotency-Key": IDEM };
const publishBody = { slug: "barbearia-a", category: "barber", area: "Centro", public_fields: ["display_name", "area", "booking_link"] };

describe("network · perfil", () => {
  it("publish exige login, negócio e Idempotency-Key antes de tocar no banco", async () => {
    const rpc = vi.fn();
    const { handler } = setup(rpc);
    expect((await handler(req("profile.publish", { body: publishBody }))).status).toBe(401);
    const noTenant = await handler(req("profile.publish", { headers: { Authorization: "Bearer t", "Idempotency-Key": IDEM }, body: publishBody }));
    expect(ErrorEnvelope.parse(await noTenant.json()).error.field).toBe("tenant_id");
    const noKey = await handler(req("profile.publish", { headers: { Authorization: "Bearer t", "X-Tinindo-Tenant": FX.tenants.A }, body: publishBody }));
    expect(ErrorEnvelope.parse(await noKey.json()).error.field).toBe("idempotency_key");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("publish recusa campo fora da whitelist (ex.: telefone)", async () => {
    const rpc = vi.fn();
    const res = await setup(rpc).handler(req("profile.publish", { headers: owner, body: { ...publishBody, public_fields: ["phone"] } }));
    expect(res.status).toBe(400);
    expect(ErrorEnvelope.parse(await res.json()).error.field).toBe("public_fields.0");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("publish chama a RPC com o JWT do usuário e hash estável; monta só campos escolhidos", async () => {
    const rpc = vi.fn(async () => ({ data: { status_code: 200, body: profileRow }, error: null }));
    const res = await setup(rpc).handler(req("profile.publish", { headers: owner, body: publishBody }));
    expect(res.status).toBe(200);
    const body = successEnvelope(PublicProfile).parse(await res.json());
    expect(body.data.fields).toEqual({
      area: "Centro",
      booking_link: `${APP}/p/barbearia-a`,
      display_name: "Barbearia Exemplo A",
    });
    const [token, fn, args] = rpc.mock.calls[0] as unknown as [string, string, Record<string, unknown>];
    expect(token).toBe("user-jwt");
    expect(fn).toBe("network_profile_publish");
    expect(args.p_tenant_id).toBe(FX.tenants.A);
    expect(args.p_request_hash).toBe(await requestHash({ ...publishBody }));
    expect(args.p_request_hash).toBe(await requestHash({ public_fields: publishBody.public_fields, area: "Centro", category: "barber", slug: "barbearia-a" }));
  });

  it("perfil de outro negócio → 403 neutro; slug em uso → 400 no campo slug", async () => {
    const forbidden = await setup(async () => ({ data: null, error: { code: "PT403", message: "FORBIDDEN" } })).handler(
      req("profile.publish", { headers: owner, body: publishBody }),
    );
    expect(forbidden.status).toBe(403);
    expect(await forbidden.text()).not.toContain(FX.tenants.A);
    const taken = await setup(async () => ({ data: null, error: { code: "PT400", message: "VALIDATION_ERROR", hint: "slug" } })).handler(
      req("profile.publish", { headers: owner, body: publishBody }),
    );
    expect(ErrorEnvelope.parse(await taken.json()).error.field).toBe("slug");
  });

  it("leitura pública é anônima, por GET, e não repassa campo extra vindo do banco", async () => {
    const rpc = vi.fn(async () => ({ data: { ...profileRow, tenant_id: FX.tenants.A, values: { ...profileRow.values, phone: "+5511999990000" } }, error: null }));
    const res = await setup(rpc).handler(req("public.profile", { method: "GET", query: "?slug=barbearia-a" }));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(FX.tenants.A);
    expect(text).not.toContain("+5511");
    expect(rpc).toHaveBeenCalledWith(null, "network_public_profile", { p_slug: "barbearia-a" });
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
  });

  it("slug inválido na leitura pública → 404 sem consultar o banco", async () => {
    const rpc = vi.fn();
    const res = await setup(rpc).handler(req("public.profile", { method: "GET", query: "?slug=' or 1=1" }));
    expect(res.status).toBe(404);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("profile.get devolve rascunho despublicado com versão", async () => {
    const rpc = vi.fn(async () => ({ data: { ...profileRow, published_at: null }, error: null }));
    const res = await setup(rpc).handler(req("profile.get", { method: "GET", headers: owner }));
    const body = successEnvelope(OwnerProfileOutput).parse(await res.json());
    expect(body.data.profile?.published_at).toBeNull();
    expect(body.data.profile?.version).toBe(2);
  });
});

describe("network · convites", () => {
  it("referral.create devolve link com token só no fragmento e sem nome do indicado", async () => {
    const rpc = vi.fn(async () => ({
      data: { referral_id: "70000000-0000-4000-8000-000000000001", token: TOKEN, expires_at: "2026-11-03T12:00:00+00:00" },
      error: null,
    }));
    const res = await setup(rpc).handler(req("referral.create", {
      headers: owner,
      body: { kind: "professional_invites_peer", invitee_name: "Colega Exemplo", invitee_category: "barber", origin: "web" },
    }));
    expect(res.status).toBe(201);
    const { data } = successEnvelope(ReferralLink).parse(await res.json());
    const url = new URL(data.share_url);
    expect(url.search).toBe("");
    expect(url.pathname).toBe("/convite");
    expect(url.hash).toBe(`#t=${TOKEN}`);
    expect(data.share_url).not.toContain("Colega");
    const args = (rpc.mock.calls[0] as unknown as [string, string, Record<string, unknown>])[2];
    expect(args.p_tenant_id).toBe(FX.tenants.A);
  });

  it("indicação do cliente ignora o tenant do header; convite de colega exige negócio", async () => {
    const rpc = vi.fn(async () => ({ data: { referral_id: "70000000-0000-4000-8000-000000000002", token: TOKEN, expires_at: "2026-11-03T12:00:00Z" }, error: null }));
    const { handler } = setup(rpc);
    await handler(req("referral.create", { headers: owner, body: { kind: "customer_recommends_professional", invitee_name: "Indicado", origin: "web" } }));
    expect((rpc.mock.calls[0] as unknown as [string, string, Record<string, unknown>])[2].p_tenant_id).toBeNull();
    const res = await handler(req("referral.create", {
      headers: { Authorization: "Bearer t", "Idempotency-Key": IDEM },
      body: { kind: "professional_invites_peer", invitee_name: "Colega", origin: "web" },
    }));
    expect(ErrorEnvelope.parse(await res.json()).error.field).toBe("tenant_id");
  });

  it("contrato não tem campo de telefone do indicado: campo extra é descartado", async () => {
    const rpc = vi.fn(async () => ({ data: { referral_id: "70000000-0000-4000-8000-000000000003", token: TOKEN, expires_at: "2026-11-03T12:00:00Z" }, error: null }));
    await setup(rpc).handler(req("referral.create", {
      headers: owner,
      body: { kind: "customer_recommends_professional", invitee_name: "Indicado", origin: "web", phone: "+5511999990000" },
    }));
    expect(JSON.stringify(rpc.mock.calls)).not.toContain("+5511");
  });

  it("link não aceita via GET: claim por GET não chama o banco", async () => {
    const rpc = vi.fn();
    const res = await setup(rpc).handler(req("referral.claim", { method: "GET", headers: owner, query: `?token=${TOKEN}` }));
    expect(res.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("inspect é anônimo, por POST, e não muda nada; token malformado → 404", async () => {
    const rpc = vi.fn(async () => ({
      data: { kind: "professional_invites_peer", invitee_category: "barber", state: "open", expires_at: "2026-11-03T12:00:00+00:00", inviter_profile_slug: "barbearia-a" },
      error: null,
    }));
    const { handler } = setup(rpc);
    const res = await handler(req("referral.inspect", { body: { token: TOKEN } }));
    expect(successEnvelope(ReferralInspectOutput).parse(await res.json()).data.state).toBe("open");
    expect(rpc).toHaveBeenCalledWith(null, "network_referral_inspect", { p_token: TOKEN });
    expect((await handler(req("referral.inspect", { body: { token: "curto" } }))).status).toBe(404);
  });

  it("claim exige login e Idempotency-Key; contato não confirmado → 403 com campo contact", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { code: "PT403", message: "FORBIDDEN", hint: "contact" } }));
    const { handler } = setup(rpc);
    expect((await handler(req("referral.claim", { body: { token: TOKEN } }))).status).toBe(401);
    expect((await handler(req("referral.claim", { headers: { Authorization: "Bearer t" }, body: { token: TOKEN } }))).status).toBe(400);
    const res = await handler(req("referral.claim", { headers: { Authorization: "Bearer t", "Idempotency-Key": IDEM }, body: { token: TOKEN } }));
    expect(res.status).toBe(403);
    expect(ErrorEnvelope.parse(await res.json()).error.field).toBe("contact");
  });

  it("convite usado ou vencido → 422 POLICY_REJECTED", async () => {
    const res = await setup(async () => ({ data: null, error: { code: "PT422", message: "POLICY_REJECTED" } })).handler(
      req("referral.claim", { headers: { Authorization: "Bearer t", "Idempotency-Key": IDEM }, body: { token: TOKEN } }),
    );
    expect(res.status).toBe(422);
  });
});

describe("network · transversal", () => {
  it("horários do link público respondem 503 enquanto a agenda real não está conectada", async () => {
    const res = await setup(vi.fn()).handler(req("public.slots", {
      body: { slug: "barbearia-a", service_id: FX.services.corteA, window: { starts_at: "2026-10-20T09:00:00-03:00", ends_at: "2026-10-20T18:00:00-03:00" } },
    }));
    expect(res.status).toBe(503);
  });

  it("horários do link público usam a porta da agenda quando conectada", async () => {
    const listPublicSlots = vi.fn(async () => ({ slots: [{ starts_at: "2026-10-20T16:00:00-03:00", ends_at: "2026-10-20T16:30:00-03:00" }], timezone: "America/Sao_Paulo" }));
    const res = await setup(vi.fn(), { listPublicSlots }).handler(req("public.slots", {
      body: { slug: "barbearia-a", service_id: FX.services.corteA, window: { starts_at: "2026-10-20T09:00:00-03:00", ends_at: "2026-10-20T18:00:00-03:00" } },
    }));
    expect(res.status).toBe(200);
    expect(listPublicSlots).toHaveBeenCalledOnce();
  });

  it("rota desconhecida → 404; falha de rede → 503; resposta fora do contrato → 500", async () => {
    expect((await setup(vi.fn()).handler(req("admin.dump", { method: "GET" }))).status).toBe(404);
    const down = await setup(async () => { throw new Error("ECONNRESET"); }).handler(req("referral.list", { method: "GET", headers: owner }));
    expect(down.status).toBe(503);
    const bad = await setup(async () => ({ data: [{ referral_id: "x", invitee_name: "Vazou" }], error: null })).handler(
      req("referral.list", { method: "GET", headers: owner }),
    );
    expect(bad.status).toBe(500);
    expect(await bad.text()).not.toContain("Vazou");
  });

  it("log sem token, tenant, nome do indicado nem token do convite; CORS só para origem permitida", async () => {
    const rpc = vi.fn(async () => ({ data: { referral_id: "70000000-0000-4000-8000-000000000004", token: TOKEN, expires_at: "2026-11-03T12:00:00Z" }, error: null }));
    const { handler, log } = setup(rpc);
    const res = await handler(req("referral.create", {
      headers: { ...owner, Authorization: "Bearer segredo" },
      body: { kind: "professional_invites_peer", invitee_name: "Nome Privado", origin: "web" },
    }));
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
    const logged = JSON.stringify(log.mock.calls);
    for (const secret of ["segredo", FX.tenants.A, "Nome Privado", TOKEN]) expect(logged).not.toContain(secret);
    const pre = await handler(new Request("http://edge/network/referral.claim", { method: "OPTIONS", headers: { Origin: "https://evil.example" } }));
    expect(pre.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});
