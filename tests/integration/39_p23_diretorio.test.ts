// P23 pelos handlers com o banco real: opt-in exige perfil publicado → busca pública com filtros e ordem documentada →
// cartão só com campos autorizados → página indexável → perfil retirado tira do diretório. SEC: outro dono.
import { afterAll, describe, expect, it } from "vitest";
import { DirectoryCitiesOutput, DirectorySearchOutput, DiscoveryOverview } from "@contracts";
import { fails, handlers, ok, pool, rpc, sql, T, U } from "./harness.ts";

const owner = { as: U.ownerA, tenant: T.A };
afterAll(() => pool.end());

describe("P23 · diretório pelos handlers", () => {
  let o: DiscoveryOverview;

  it("1 · opt-in exige perfil publicado; cidade normalizada; cartão só com campos autorizados", async () => {
    await sql("update public.public_profiles set published_at = null where tenant_id = $1", [T.A]);
    o = await ok(DiscoveryOverview, "discovery", "discovery.get", { ...owner, body: {} });
    await fails("discovery", "discovery.save", { ...owner, key: true, body: { expected_version: o.listing?.version ?? 0, uf: "SP", city_name: "São Paulo", listed: true } },
      "POLICY_REJECTED", "profile");
    await sql(`insert into public.public_profiles (tenant_id, slug, category, area, public_fields, published_at) values ($1, 'barbearia-exemplo-a', 'barber', 'Pinheiros', array['area','display_name','booking_link'], now())
      on conflict (tenant_id) do update set public_fields = array['area','display_name','booking_link'], published_at = now(), area = 'Pinheiros'`, [T.A]);
    o = await ok(DiscoveryOverview, "discovery", "discovery.save", { ...owner, key: true, body: { expected_version: o.listing?.version ?? 0, uf: "sp", city_name: " São Paulo ", show_hours: true, listed: true } });
    expect(o.listing).toMatchObject({ uf: "SP", city_slug: "sao-paulo", status: "listed" });
    expect(o.visible).toBe(true);
    expect(o.card).toMatchObject({ display_name: "Barbearia Exemplo A", city_slug: "sao-paulo", booking: true });
  });

  it("2 · busca pública: filtros exatos, ordem documentada, nada privado; índice de cidades; página indexável", async () => {
    const r = await ok(DirectorySearchOutput, "discovery", "directory.search", { as: null, body: { uf: "SP", city_slug: "sao-paulo", category: "barber" } });
    expect(r.items.map((x) => x.slug)).toContain("barbearia-exemplo-a");
    expect(r.criteria.order).toBe("ordem alfabética do nome exibido");
    expect(JSON.stringify(r)).not.toMatch(/exemplo\.test|phone|email|price/);
    const none = await ok(DirectorySearchOutput, "discovery", "directory.search", { as: null, body: { uf: "SP", city_slug: "sao-paulo", category: "personal_trainer" } });
    expect(none.items.map((x) => x.slug)).not.toContain("barbearia-exemplo-a");
    const c = await ok(DirectoryCitiesOutput, "discovery", "directory.cities", { as: null, body: {} });
    expect(c.cities).toEqual(expect.arrayContaining([expect.objectContaining({ uf: "SP", city_slug: "sao-paulo" })]));
    const page = await handlers.discovery!(new Request("http://edge/functions/v1/discovery/page?uf=SP&city=sao-paulo&category=barber"));
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("Barbearia Exemplo A");
  });

  it("3 · perfil retirado do ar sai do diretório; suspensão pelo backend não é desfeita pelo dono", async () => {
    await sql("update public.public_profiles set published_at = null where tenant_id = $1", [T.A]);
    const r = await ok(DirectorySearchOutput, "discovery", "directory.search", { as: null, body: { uf: "SP", city_slug: "sao-paulo" } });
    expect(r.items.map((x) => x.slug)).not.toContain("barbearia-exemplo-a");
    await sql("update public.public_profiles set published_at = now() where tenant_id = $1", [T.A]);
    expect((await rpc("worker", "discovery_moderate", { p_tenant_id: T.A, p_action: "suspend", p_reason: "Denúncia em análise" })).error).toBeNull();
    o = await ok(DiscoveryOverview, "discovery", "discovery.get", { ...owner, body: {} });
    o = await ok(DiscoveryOverview, "discovery", "discovery.save", { ...owner, key: true, body: { expected_version: o.listing!.version, uf: "SP", city_name: "São Paulo", listed: true } });
    expect(o.listing?.status).toBe("suspended");
    expect((await rpc("worker", "discovery_moderate", { p_tenant_id: T.A, p_action: "release", p_reason: null })).error).toBeNull();
  });

  it("SEC · outro dono não vê nem altera; sem login não há painel", async () => {
    await fails("discovery", "discovery.get", { as: U.ownerB, tenant: T.A, body: {} }, "FORBIDDEN");
    await fails("discovery", "discovery.save", { as: U.ownerB, tenant: T.A, key: true, body: { expected_version: 1, uf: "SP", city_name: "Campinas", listed: false } }, "FORBIDDEN");
    await fails("discovery", "discovery.get", { as: null, tenant: T.A, body: {} }, "AUTH_REQUIRED");
  });
});
