import { describe, expect, it, vi } from "vitest";
import { FX } from "../_shared/contracts/fixtures.ts";
import { createDiscoveryHandler, type DiscoveryDeps } from "./handler.ts";

const criteria = { filters: ["profissão (exata)"], order: "ordem alfabética do nome exibido", never: ["destaque pago"], page_size: 20 };
const card = { slug: "barbearia-a", display_name: "Barbearia <A>", category: "barber", area: "Pinheiros", city_name: "São Paulo", city_slug: "sao-paulo", uf: "SP",
  profile_path: "/p/barbearia-a", site_path: "/s/barbearia-a", booking: true, weekdays: [1, 2] };
const result = { criteria, total: 1, page: 1, items: [card], city_name: "São Paulo" };
const setup = (over: Partial<DiscoveryDeps> = {}) => {
  const deps: DiscoveryDeps = {
    allowedOrigins: [], publicAppUrl: "https://app.exemplo.test",
    rpc: vi.fn(async () => ({ data: null, error: null })),
    anonRpc: vi.fn(async () => ({ data: result, error: null })),
    ...over,
  };
  return { deps, handler: createDiscoveryHandler(deps) };
};
const post = (op: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://edge/functions/v1/discovery/${op}`, { method: "POST", headers, body: JSON.stringify(body) });

describe("Edge Function discovery", () => {
  it("busca pública sem login: normaliza UF; filtros inválidos caem antes do banco", async () => {
    const { handler, deps } = setup();
    const res = await handler(post("directory.search", { uf: "sp", city_slug: "sao-paulo", weekday: 3 }));
    expect(res.status).toBe(200);
    expect(deps.anonRpc).toHaveBeenCalledWith("discovery_search", { p_uf: "SP", p_city_slug: "sao-paulo", p_category: null, p_area: null, p_weekday: 3, p_page: 1 });
    expect((await handler(post("directory.search", { uf: "XX", city_slug: "sao-paulo" }))).status).toBe(400);
    expect((await handler(post("directory.search", { uf: "SP", city_slug: "São Paulo" }))).status).toBe(400);
    expect((await handler(post("directory.search", { uf: "SP", city_slug: "sao-paulo", category: "ranking" }))).status).toBe(400);
  });

  it("campo fora do cartão autorizado (ex.: telefone) é removido pelo contrato antes de sair", async () => {
    const leaky = setup({ anonRpc: vi.fn(async () => ({ data: { ...result, items: [{ ...card, phone: "+5511999999999" }] }, error: null })) });
    const json = await (await leaky.handler(post("directory.search", { uf: "SP", city_slug: "sao-paulo" }))).json();
    expect(JSON.stringify(json)).not.toContain("999999999");
  });

  it("página indexável: título, canônico, ItemList, critérios; texto escapado; sem nota", async () => {
    const { handler } = setup();
    const res = await handler(new Request("http://edge/functions/v1/discovery/page?uf=SP&city=sao-paulo&category=barber"));
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("<title>Barbearias em São Paulo/SP</title>");
    expect(html).toContain('<link rel="canonical" href="https://app.exemplo.test/diretorio/sp/sao-paulo/barber">');
    expect(html).toContain('"@type":"ItemList"');
    expect(html).toContain("Barbearia &lt;A&gt;");
    expect(html).toContain("sem destaque pago");
    expect(html).not.toMatch(/aggregateRating|ratingValue/);
    expect((await handler(new Request("http://edge/functions/v1/discovery/page?uf=ZZ&city=x"))).status).toBe(404);
  });

  it("opt-in do dono: comando com chave; UF minúscula aceita", async () => {
    const overview = { criteria, profile: { exists: true, published: true, slug: "barbearia-a", public_fields: [] }, listing: null, card: null, visible: false };
    const rpc = vi.fn(async () => ({ data: { status_code: 200, body: overview }, error: null }));
    const { handler } = setup({ rpc });
    const h = { Authorization: "Bearer jwt", "X-Tinindo-Tenant": FX.tenants.A };
    expect((await handler(post("discovery.save", { expected_version: 0, uf: "sp", city_name: "São Paulo", listed: true }, h))).status).toBe(400);
    const res = await handler(post("discovery.save", { expected_version: 0, uf: "sp", city_name: "São Paulo", listed: true }, { ...h, "Idempotency-Key": "chave-diretorio-00000001" }));
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("jwt", "discovery_save", expect.objectContaining({ p_uf: "SP", p_listed: true, p_show_hours: false }));
  });
});
