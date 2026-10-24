import { describe, expect, it, vi } from "vitest";
import { ErrorEnvelope, type PublicSite } from "../_shared/contracts/index.ts";
import { FX } from "../_shared/contracts/fixtures.ts";
import { escapeHtml, renderSitePage } from "../_shared/domain/presence/render.ts";
import { createPresenceHandler, type PresenceDeps } from "./handler.ts";

const hash = "a".repeat(64);
const snapshot: PublicSite["site"] = {
  slug: "barbearia-a", display_name: "Barbearia <Exemplo> A", category: "barber", area: "Centro", bio: null, headline: "Corte & barba",
  theme: "papel", sections: ["services", "prices", "booking"], services: [{ name: "Corte", duration_min: 30, price_cents: 6000 }], hours: [],
  booking_path: "/p/barbearia-a", timezone: "America/Sao_Paulo",
};
const pub: PublicSite = { site: snapshot, version_no: 2, snapshot_hash: hash, published_at: "2026-10-24T12:00:00Z", hostname: null };
const overview = {
  rules: { txt_name_prefix: "_tinindo-verify", txt_value_prefix: "tinindo-verify=", check_cooldown_seconds: 20, max_services: 30, headline_max: 90 },
  profile: { exists: true, published: true, slug: "barbearia-a", public_fields: ["display_name"] },
  site: { headline: null, sections: ["services"], theme: "papel", status: "draft", service_ids: [], version: 0 },
  catalog: [], preview: snapshot, preview_hash: hash, published: null, versions: [], domain: null,
  google: { status: "not_connected", profile_name: null, profile_url: null, access_level: "manager", granted_at: null, revoked_at: null, version: 0 },
  deliveries: [],
};
const domain = { id: FX.tenants.B, hostname: "barbearia-a.com.br", status: "verified", txt_name: "_tinindo-verify.barbearia-a.com.br", txt_value: "tinindo-verify=x",
  last_check_at: "2026-10-24T12:00:00Z", last_check_result: "found", verified_at: "2026-10-24T12:00:00Z", created_at: "2026-10-24T11:00:00Z", version: 2 };

const setup = (over: Partial<PresenceDeps> = {}) => {
  const deps: PresenceDeps = {
    allowedOrigins: [], publicAppUrl: "https://app.exemplo.test", cnameTarget: "sites.exemplo.test",
    rpc: vi.fn(async () => ({ data: overview, error: null })),
    serviceRpc: vi.fn(async () => ({ data: { result: "found", domain }, error: null })),
    anonRpc: vi.fn(async () => ({ data: pub, error: null })),
    resolveTxt: vi.fn(async () => ["tinindo-verify=x"]),
    ...over,
  };
  return { deps, handler: createPresenceHandler(deps) };
};
const post = (op: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://edge/functions/v1/presence/${op}`, { method: "POST", headers, body: JSON.stringify(body) });
const owner = { Authorization: "Bearer jwt", "X-Tinindo-Tenant": FX.tenants.A };
const key = { ...owner, "Idempotency-Key": "chave-presenca-00000001" };

describe("Edge Function presence", () => {
  it("visão do dono ganha o destino do CNAME do ambiente; publicar exige o hash da prévia", async () => {
    const { handler, deps } = setup();
    const res = await handler(post("presence.get", {}, owner));
    expect(res.status).toBe(200);
    expect((await res.json()).data.cname_target).toBe("sites.exemplo.test");
    expect((await handler(post("site.publish", {}, key))).status).toBe(400);
    expect((await handler(post("site.publish", { expected_hash: "curto" }, key))).status).toBe(400);
    (deps.rpc as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ data: { status_code: 201, body: overview }, error: null });
    expect((await handler(post("site.publish", { expected_hash: hash }, key))).status).toBe(201);
    expect(deps.rpc).toHaveBeenLastCalledWith("jwt", "presence_site_publish", expect.objectContaining({ p_expected_hash: hash, p_idem_key: "chave-presenca-00000001" }));
  });

  it("rascunho: seção inventada ou repetida cai antes do banco", async () => {
    const { handler, deps } = setup();
    expect((await handler(post("site.save", { expected_version: 0, sections: ["ranking"] }, key))).status).toBe(400);
    expect((await handler(post("site.save", { expected_version: 0, sections: ["services", "services"] }, key))).status).toBe(400);
    expect(deps.rpc).not.toHaveBeenCalled();
  });

  it("verificar domínio: o dono autoriza, a função consulta o TXT e o banco decide pelo observado", async () => {
    const rpc = vi.fn(async () => ({ data: { domain_id: FX.tenants.B, txt_name: "_tinindo-verify.barbearia-a.com.br" }, error: null }));
    const { handler, deps } = setup({ rpc });
    const res = await handler(post("domain.check", { domain_id: FX.tenants.B }, owner));
    expect(res.status).toBe(200);
    expect((await res.json()).data.result).toBe("found");
    expect(rpc).toHaveBeenCalledWith("jwt", "presence_domain_check_target", { p_tenant_id: FX.tenants.A, p_domain_id: FX.tenants.B });
    expect(deps.resolveTxt).toHaveBeenCalledWith("_tinindo-verify.barbearia-a.com.br");
    expect(deps.serviceRpc).toHaveBeenCalledWith("presence_domain_record_check", { p_domain_id: FX.tenants.B, p_observed: ["tinindo-verify=x"], p_lookup_failed: false });
  });

  it("verificar domínio: falha do DNS é registrada como falha (nunca verificado); sem permissão nem consulta", async () => {
    const rpc = vi.fn(async () => ({ data: { domain_id: FX.tenants.B, txt_name: "_tinindo-verify.x.com.br" }, error: null }));
    const resolveTxt = vi.fn(async () => { throw new Error("SERVFAIL"); });
    const { handler, deps } = setup({ rpc, resolveTxt });
    await handler(post("domain.check", { domain_id: FX.tenants.B }, owner));
    expect(deps.serviceRpc).toHaveBeenCalledWith("presence_domain_record_check", expect.objectContaining({ p_observed: [], p_lookup_failed: true }));
    const denied = setup({ rpc: vi.fn(async () => ({ data: null, error: { code: "PT403", message: "FORBIDDEN" } })) });
    const res = await denied.handler(post("domain.check", { domain_id: FX.tenants.B }, owner));
    expect(res.status).toBe(403);
    expect(denied.deps.resolveTxt).not.toHaveBeenCalled();
    expect(denied.deps.serviceRpc).not.toHaveBeenCalled();
    const cooldown = setup({ rpc: vi.fn(async () => ({ data: null, error: { code: "PT429", message: "QUOTA_EXCEEDED", hint: "cooldown" } })) });
    expect(ErrorEnvelope.parse(await (await cooldown.handler(post("domain.check", { domain_id: FX.tenants.B }, owner))).json()).error.field).toBe("cooldown");
  });

  it("Google: conceder exige nome do perfil; revogar só versão; entrega da operação exige evidência https", async () => {
    const { handler } = setup();
    expect((await handler(post("google.set", { action: "grant", expected_version: 0 }, key))).status).toBe(400);
    expect((await handler(post("ops.presence_delivery", { kind: "google_post", summary: "x", evidence_url: "http://x.test/a" }, key))).status).toBe(400);
    expect((await handler(post("ops.presence_delivery", { kind: "ranking_boost", summary: "x", evidence_url: "https://x.test/a" }, key))).status).toBe(400);
  });

  it("página pública: HTML indexável com canônico e dados estruturados; texto escapado; sem nota inventada", async () => {
    const { handler, deps } = setup();
    const res = await handler(new Request("http://edge/functions/v1/presence/page?slug=barbearia-a"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain('<link rel="canonical" href="https://app.exemplo.test/s/barbearia-a">');
    expect(html).toContain("Barbearia &lt;Exemplo&gt; A");
    expect(html).not.toContain("<Exemplo>");
    expect(html).toContain('"@type":"LocalBusiness"');
    expect(html).not.toMatch(/aggregateRating|ratingValue|ranking|primeiro lugar/i);
    expect(html).toContain('href="https://app.exemplo.test/p/barbearia-a"');
    expect(deps.anonRpc).toHaveBeenCalledWith("presence_public_site", { p_slug: "barbearia-a", p_host: null });
    const gone = setup({ anonRpc: vi.fn(async () => ({ data: null, error: { code: "PT404", message: "NOT_FOUND" } })) });
    const nf = await gone.handler(new Request("http://edge/functions/v1/presence/page?host=Barbearia-A.com.br"));
    expect(nf.status).toBe(404);
    expect(nf.headers.get("Cache-Control")).toBe("no-store");
    expect(gone.deps.anonRpc).toHaveBeenCalledWith("presence_public_site", { p_slug: null, p_host: "barbearia-a.com.br" });
  });

  it("renderização: domínio verificado vira o canônico; escape cobre aspas", () => {
    expect(renderSitePage({ ...pub, hostname: "barbearia-a.com.br" }, { origin: "https://app.exemplo.test" })).toContain('href="https://barbearia-a.com.br/"');
    expect(escapeHtml(`"'<>&`)).toBe("&quot;&#39;&lt;&gt;&amp;");
  });
});
