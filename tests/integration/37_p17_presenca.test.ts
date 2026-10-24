// P17 pelos handlers com o banco real: rascunho → prévia só com dados públicos → publicar o hash visto → página
// pública (JSON e HTML indexável) → preço novo não muda o publicado → tirar do ar e voltar versão. Domínio do cliente:
// TXT ausente não verifica; com o TXT certo o banco verifica e o nome abre o site. Google: entrega da operação só com
// acesso concedido; revogado, nada. SEC: outro dono.
import { afterAll, describe, expect, it } from "vitest";
import { DeliveryRecordOutput, DomainCheckOutput, PresenceOverview, PublicSiteOutput } from "@contracts";
import { DNS, fails, handlers, ok, pool, PUBLIC_APP_URL, sql, T, U } from "./harness.ts";

const owner = { as: U.ownerA, tenant: T.A };
const OPERATOR = "e0000000-0000-4000-8000-0000000000e1";
const CORTE = "40000000-0000-4000-8000-0000000000a1";
const BARBA = "40000000-0000-4000-8000-0000000000a2";
afterAll(() => pool.end());

describe("P17 · presença digital pelos handlers", () => {
  let o: PresenceOverview;
  let slug = "";

  it("1 · rascunho e prévia só com dados públicos; publicar exige o hash visto; página pública em JSON e HTML", async () => {
    await sql(`insert into public.public_profiles (tenant_id, slug, category, area, public_fields, published_at) values ($1, 'barbearia-exemplo-a', 'barber', 'Pinheiros', array['area','display_name','booking_link'], now())
      on conflict (tenant_id) do update set public_fields = array['area','display_name','booking_link'], published_at = now()`, [T.A]);
    slug = (await sql<{ slug: string }>("select slug from public.public_profiles where tenant_id = $1", [T.A]))[0]!.slug;
    o = await ok(PresenceOverview, "presence", "presence.get", { ...owner, body: {} });
    o = await ok(PresenceOverview, "presence", "site.save", { ...owner, key: true, body: { expected_version: o.site.version, headline: "Corte na hora marcada",
      sections: ["services", "prices", "booking"], service_ids: [CORTE, BARBA] } });
    expect(o.preview?.services.map((s) => s.name)).toEqual(["Corte", "Barba"]);
    expect(o.preview?.booking_path).toBe(`/p/${slug}`);
    expect(JSON.stringify(o.preview)).not.toMatch(/min_price|estimated|Cliente|exemplo\.test/);
    await fails("presence", "site.publish", { ...owner, key: true, body: { expected_hash: "f".repeat(64) } }, "STALE_VERSION", "preview");
    o = await ok(PresenceOverview, "presence", "site.publish", { ...owner, key: true, body: { expected_hash: o.preview_hash } });
    expect(o.published).toMatchObject({ snapshot_hash: o.preview_hash });
    const pub = await ok(PublicSiteOutput, "presence", "presence.public_site", { as: null, body: { slug } });
    expect(pub.site.headline).toBe("Corte na hora marcada");
    const page = await handlers.presence!(new Request(`http://edge/functions/v1/presence/page?slug=${slug}`));
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain(`<link rel="canonical" href="${PUBLIC_APP_URL}/s/${slug}">`);
    expect(html).toContain("Corte na hora marcada");
  });

  it("2 · preço novo não muda o publicado; tirar do ar some a página; voltar põe a versão aprovada de novo", async () => {
    const before = o.published!.version_no;
    await sql("update public.provider_services set base_price_cents = base_price_cents + 500 where id = $1", [CORTE]);
    const g = await ok(PresenceOverview, "presence", "presence.get", { ...owner, body: {} });
    expect(g.preview_hash).not.toBe(g.published!.snapshot_hash);
    const stillOld = await ok(PublicSiteOutput, "presence", "presence.public_site", { as: null, body: { slug } });
    expect(stillOld.version_no).toBe(before);
    o = await ok(PresenceOverview, "presence", "site.unpublish", { ...owner, key: true, body: { expected_version: g.site.version } });
    await fails("presence", "presence.public_site", { as: null, body: { slug } }, "NOT_FOUND");
    expect((await handlers.presence!(new Request(`http://edge/functions/v1/presence/page?slug=${slug}`))).status).toBe(404);
    o = await ok(PresenceOverview, "presence", "site.restore", { ...owner, key: true, body: { version_no: before, expected_version: o.site.version } });
    expect((await ok(PublicSiteOutput, "presence", "presence.public_site", { as: null, body: { slug } })).version_no).toBe(before);
    expect(o.deliveries.map((d) => d.kind).slice(0, 3)).toEqual(["site_restored", "site_unpublished", "site_published"]);
    await sql("update public.provider_services set base_price_cents = base_price_cents - 500 where id = $1", [CORTE]);
  });

  it("3 · domínio do cliente: sem TXT não verifica; com o TXT certo o banco verifica e o nome abre o site", async () => {
    o = await ok(PresenceOverview, "presence", "domain.add", { ...owner, key: true, body: { hostname: "Barbearia-Exemplo-A.com.br" } });
    const d = o.domain!;
    expect(d).toMatchObject({ hostname: "barbearia-exemplo-a.com.br", status: "pending", txt_name: "_tinindo-verify.barbearia-exemplo-a.com.br" });
    expect(o.cname_target).toBeNull();
    const miss = await ok(DomainCheckOutput, "presence", "domain.check", { ...owner, body: { domain_id: d.id } });
    expect(miss.result).toBe("not_found");
    await fails("presence", "domain.check", { ...owner, body: { domain_id: d.id } }, "QUOTA_EXCEEDED", "cooldown");
    await sql("update public.presence_domains set last_check_at = now() - interval '1 hour' where id = $1", [d.id]);
    DNS.set(d.txt_name, ["v=spf1 -all", d.txt_value]);
    const hit = await ok(DomainCheckOutput, "presence", "domain.check", { ...owner, body: { domain_id: d.id } });
    expect(hit).toMatchObject({ result: "found", domain: { status: "verified" } });
    const byHost = await ok(PublicSiteOutput, "presence", "presence.public_site", { as: null, body: { host: "barbearia-exemplo-a.com.br" } });
    expect(byHost).toMatchObject({ hostname: "barbearia-exemplo-a.com.br", site: { slug } });
    const checks = await sql<{ n: number }>("select count(*)::int as n from public.presence_domain_checks where domain_id = $1", [d.id]);
    expect(checks[0]!.n).toBe(2);
    await fails("presence", "domain.add", { as: U.ownerB, tenant: T.B, key: true, body: { hostname: "barbearia-exemplo-a.com.br" } }, "POLICY_REJECTED", "hostname_taken");
  });

  it("4 · Google: entrega da operação só com acesso de gerente concedido; revogado, nada mais", async () => {
    await sql("insert into public.platform_operators (user_id, display_name) values ($1, 'Operadora (exemplo)') on conflict do nothing", [OPERATOR]);
    const delivery = { kind: "google_post", summary: "Post de horário de feriado.", evidence_url: "https://maps.app.goo.gl/exemplo" };
    await fails("presence", "ops.presence_delivery", { as: OPERATOR, tenant: T.A, key: true, body: delivery }, "POLICY_REJECTED", "google_access");
    o = await ok(PresenceOverview, "presence", "google.set", { ...owner, key: true, body: { action: "grant", profile_name: "Barbearia Exemplo A", profile_url: "https://maps.app.goo.gl/exemplo", expected_version: o.google.version } });
    expect(o.google).toMatchObject({ status: "granted", access_level: "manager" });
    const rec = await ok(DeliveryRecordOutput, "presence", "ops.presence_delivery", { as: OPERATOR, tenant: T.A, key: true, body: delivery });
    expect(rec.delivery).toMatchObject({ kind: "google_post", actor: "operator", evidence: { url: "https://maps.app.goo.gl/exemplo" } });
    await fails("presence", "ops.presence_delivery", { as: U.ownerA, tenant: T.A, key: true, body: delivery }, "FORBIDDEN");
    o = await ok(PresenceOverview, "presence", "google.set", { ...owner, key: true, body: { action: "revoke", expected_version: o.google.version } });
    await fails("presence", "ops.presence_delivery", { as: OPERATOR, tenant: T.A, key: true, body: delivery }, "POLICY_REJECTED", "google_access");
  });

  it("SEC · outro dono não lê nem publica; sem login não há painel", async () => {
    await fails("presence", "presence.get", { as: U.ownerB, tenant: T.A, body: {} }, "FORBIDDEN");
    await fails("presence", "site.publish", { as: U.ownerB, tenant: T.A, key: true, body: { expected_hash: "a".repeat(64) } }, "FORBIDDEN");
    await fails("presence", "presence.get", { as: null, tenant: T.A, body: {} }, "AUTH_REQUIRED");
  });
});
