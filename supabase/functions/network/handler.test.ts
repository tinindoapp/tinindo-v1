import { describe, expect, it, vi } from "vitest";
import { ErrorEnvelope, PublicProfile, ReferralLink, successEnvelope } from "../_shared/contracts/index.ts";
import { FX } from "../_shared/contracts/fixtures.ts";
import { createNetworkHandler, type NetworkDeps, requestHash } from "./handler.ts";
import { OwnerProfileOutput, PublicBookOutput, PublicServicesOutput, ReferralInspectOutput } from "./schemas.ts";

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

  const PHOTO = `${FX.tenants.A}/5f0c3b6e-1d2a-4c3b-9e8f-0a1b2c3d4e5f.webp`;
  const BUCKET = "https://exemplo.supabase.co/storage/v1/object/public/profile-photos";
  const media = { photo_path: PHOTO, photo_alt: "Foto de Barbearia Exemplo A", show_photo: true, show_whatsapp: true, show_prices: false,
    whatsapp_e164: "+5511933334444" };
  const mediaBody = { photo_path: PHOTO, photo_alt: null, show_photo: true, show_whatsapp: true, show_prices: false };

  it("profile.media grava pela RPC do dono e devolve as chaves com a URL pública da foto", async () => {
    const rpc = vi.fn(async () => ({ data: { status_code: 200, body: { ...profileRow, media } }, error: null }));
    const res = await setup(rpc, { photoBaseUrl: BUCKET }).handler(req("profile.media", { headers: owner, body: mediaBody }));
    expect(res.status).toBe(200);
    const profile = successEnvelope(OwnerProfileOutput).parse(await res.json()).data.profile!;
    expect(profile.media).toEqual({ ...media, photo_url: `${BUCKET}/${PHOTO}` });
    expect(rpc).toHaveBeenCalledWith("user-jwt", "network_profile_media_set", expect.objectContaining({
      p_tenant_id: FX.tenants.A, p_photo_path: PHOTO, p_photo_alt: null, p_show_photo: true, p_show_whatsapp: true, p_show_prices: false,
      p_idem_key: IDEM, p_request_hash: await requestHash(mediaBody),
    }));
  });

  it("profile.media recusa caminho fora da pasta do formato e corpo sem as chaves, sem tocar no banco", async () => {
    const rpc = vi.fn();
    const { handler } = setup(rpc);
    for (const photo_path of ["../outro/foto.webp", `${FX.tenants.A}/foto.png`, "https://evil.example/x.webp"]) {
      const res = await handler(req("profile.media", { headers: owner, body: { ...mediaBody, photo_path } }));
      expect(ErrorEnvelope.parse(await res.json()).error).toMatchObject({ code: "VALIDATION_ERROR", field: "photo_path" });
    }
    expect((await handler(req("profile.media", { headers: owner, body: { photo_path: null } }))).status).toBe(400);
    expect((await handler(req("profile.media", { headers: { ...owner, Authorization: "" }, body: mediaBody }))).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("leitura pública: foto vira URL do bucket e o WhatsApp passa como veio (o banco já filtrou pelas chaves)", async () => {
    const row = { ...profileRow, photo: { path: PHOTO, alt: "Fachada" }, whatsapp_e164: "+5511933334444" };
    const on = await setup(vi.fn(async () => ({ data: row, error: null })), { photoBaseUrl: BUCKET })
      .handler(req("public.profile", { method: "GET", query: "?slug=barbearia-a" }));
    expect(successEnvelope(PublicProfile).parse(await on.json()).data).toMatchObject({
      photo: { url: `${BUCKET}/${PHOTO}`, alt: "Fachada" }, whatsapp_e164: "+5511933334444",
    });
    const off = await setup(vi.fn(async () => ({ data: { ...row, photo: null, whatsapp_e164: null }, error: null })), { photoBaseUrl: BUCKET })
      .handler(req("public.profile", { method: "GET", query: "?slug=barbearia-a" }));
    expect(successEnvelope(PublicProfile).parse(await off.json()).data).toMatchObject({ photo: null, whatsapp_e164: null });
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

describe("network · reserva pelo link (P43)", () => {
  const visitor = { "Idempotency-Key": IDEM };
  const bookBody = {
    slug: "barbearia-a",
    service_id: FX.services.corteA,
    starts_at: "2026-10-27T13:00:00Z",
    contact: { name: "Maria", phone_e164: "+5511977774343" },
  };
  const bookRow = {
    request_id: "70000000-0000-4000-8000-000000000043",
    slot: { starts_at: "2026-10-27T13:00:00Z", ends_at: "2026-10-27T13:30:00Z" },
    expires_at: "2026-10-27T12:15:00Z",
    delivery: "queued",
  };

  it("public.book exige Idempotency-Key e telefone E.164 antes de tocar no banco", async () => {
    const rpc = vi.fn();
    const { handler } = setup(rpc);
    const noKey = await handler(req("public.book", { body: bookBody }));
    expect(ErrorEnvelope.parse(await noKey.json()).error.field).toBe("idempotency_key");
    const badPhone = await handler(req("public.book", { headers: visitor, body: { ...bookBody, contact: { name: "Maria", phone_e164: "11977774343" } } }));
    expect(badPhone.status).toBe(400);
    expect(ErrorEnvelope.parse(await badPhone.json()).error.field).toBe("contact.phone_e164");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("public.book chama a RPC como anon (ou com o JWT, se houver) e hash estável; responde 201", async () => {
    const rpc = vi.fn(async () => ({ data: { status_code: 201, body: bookRow }, error: null }));
    const { handler } = setup(rpc);
    const res = await handler(req("public.book", { headers: visitor, body: bookBody }));
    expect(res.status).toBe(201);
    expect(successEnvelope(PublicBookOutput).parse(await res.json()).data.request_id).toBe(bookRow.request_id);
    expect(rpc).toHaveBeenCalledWith(null, "public_booking_request", expect.objectContaining({
      p_slug: "barbearia-a",
      p_contact_phone: "+5511977774343",
      p_idem_key: IDEM,
      p_request_hash: await requestHash(bookBody),
    }));
    await handler(req("public.book", { headers: { ...visitor, Authorization: "Bearer cliente-jwt" }, body: bookBody }));
    expect(rpc).toHaveBeenLastCalledWith("cliente-jwt", "public_booking_request", expect.anything());
  });

  it("public.book: pedido pendente do mesmo WhatsApp vira 409 só com id e prazo; replace_existing vai para a RPC e volta replaced", async () => {
    const summary = { request_id: bookRow.request_id, expires_at: "2026-10-27T12:15:00Z" };
    const pending = vi.fn(async () => ({
      data: { status_code: 409, error: "PENDING_REQUEST_EXISTS", field: "contact.phone_e164", details: { ...summary, service_name: "Corte", starts_at: "2026-10-30T17:00:00Z", contact_phone: "+5511977774343" } },
      error: null,
    }));
    const res = await setup(pending).handler(req("public.book", { headers: visitor, body: bookBody }));
    expect(res.status).toBe(409);
    const body = ErrorEnvelope.parse(await res.json());
    expect(body.error).toMatchObject({ code: "PENDING_REQUEST_EXISTS", field: "contact.phone_e164" });
    // Só id e prazo saem: serviço, horário e telefone não vazam do envelope.
    expect(body.error.details).toEqual(summary);
    expect(pending).toHaveBeenCalledWith(null, "public_booking_request", expect.objectContaining({ p_replace_existing: false }));

    const broken = vi.fn(async () => ({ data: { status_code: 409, error: "PENDING_REQUEST_EXISTS", details: { request_id: "x" } }, error: null }));
    expect((await setup(broken).handler(req("public.book", { headers: visitor, body: bookBody }))).status).toBe(500);

    const replaced = true;
    const swap = vi.fn(async () => ({ data: { status_code: 201, body: { ...bookRow, replaced } }, error: null }));
    const ok = await setup(swap).handler(req("public.book", { headers: visitor, body: { ...bookBody, replace_existing: true } }));
    expect(ok.status).toBe(201);
    expect(successEnvelope(PublicBookOutput).parse(await ok.json()).data.replaced).toEqual(replaced);
    expect(swap).toHaveBeenCalledWith(null, "public_booking_request", expect.objectContaining({ p_replace_existing: true }));
  });

  it("public.confirm traduz código errado (envelope 4xx gravado) e erro do banco", async () => {
    const wrong = vi.fn(async () => ({ data: { status_code: 422, error: "POLICY_REJECTED", field: "code" }, error: null }));
    const res = await setup(wrong).handler(req("public.confirm", { headers: visitor, body: { request_id: bookRow.request_id, code: "123456" } }));
    expect(res.status).toBe(422);
    expect(ErrorEnvelope.parse(await res.json()).error).toMatchObject({ code: "POLICY_REJECTED", field: "code" });
    expect(wrong).toHaveBeenCalledWith(null, "public_booking_confirm", expect.objectContaining({ p_request: bookRow.request_id, p_code: "123456" }));
    const expired = vi.fn(async () => ({ data: null, error: { code: "PT422", message: "POLICY_REJECTED", hint: "expires_at" } }));
    const late = await setup(expired).handler(req("public.confirm", { headers: visitor, body: { request_id: bookRow.request_id, code: "123456" } }));
    expect(ErrorEnvelope.parse(await late.json()).error).toMatchObject({ code: "POLICY_REJECTED", field: "expires_at" });
  });

  it("public.confirm recusa código fora do formato sem chamar o banco; status inesperado vira 500", async () => {
    const rpc = vi.fn(async () => ({ data: { status_code: 302, body: {} }, error: null }));
    const { handler } = setup(rpc);
    expect((await handler(req("public.confirm", { headers: visitor, body: { request_id: bookRow.request_id, code: "12a456" } }))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
    expect((await handler(req("public.confirm", { headers: visitor, body: { request_id: bookRow.request_id, code: "123456" } }))).status).toBe(500);
  });

  it("public.contact é do dono: exige login e negócio; passa o tenant para a RPC", async () => {
    const rpc = vi.fn(async () => ({ data: { name: "Maria", phone_e164: "+5511977774343", requested_at: "2026-10-27T12:00:00Z", status: "confirmed" }, error: null }));
    const { handler } = setup(rpc);
    expect((await handler(req("public.contact", { body: { booking_id: bookRow.request_id } }))).status).toBe(401);
    const res = await handler(req("public.contact", { headers: { Authorization: "Bearer user-jwt", "X-Tinindo-Tenant": FX.tenants.A }, body: { booking_id: bookRow.request_id } }));
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("user-jwt", "public_booking_contact", { p_tenant_id: FX.tenants.A, p_booking_id: bookRow.request_id });
  });

  it("public.services é consulta por POST com o slug no corpo; saída fora do contrato vira 500", async () => {
    const rpc = vi.fn(async () => ({ data: { services: [{ id: FX.services.corteA, name: "Corte", duration_min: 30 }] }, error: null }));
    const { handler } = setup(rpc);
    expect(ErrorEnvelope.parse(await (await handler(req("public.services", { method: "GET", query: "?slug=barbearia-a" }))).json()).error.message).toBe("Use POST.");
    const res = await handler(req("public.services", { body: { slug: "barbearia-a" } }));
    expect(successEnvelope(PublicServicesOutput).parse(await res.json()).data.services).toHaveLength(1);
    expect(rpc).toHaveBeenCalledWith(null, "public_booking_services", { p_slug: "barbearia-a" });
    const leaky = vi.fn(async () => ({ data: { services: [{ id: FX.services.corteA, name: "Corte" }] }, error: null }));
    expect((await setup(leaky).handler(req("public.services", { body: { slug: "barbearia-a" } }))).status).toBe(500);
  });
});
