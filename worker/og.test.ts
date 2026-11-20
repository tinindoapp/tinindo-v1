// Prévia do link (E1; D18, D19, D24): tags do perfil e das páginas do cliente no HTML, redirecionamento de /s,
// canonical e JSON-LD no perfil, escape de texto e queda segura para o padrão.
/// <reference types="node" />
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { handle } from "./index.ts";
import { injectTags, OG_END, OG_START, renderTags, routeOf } from "./og.ts";

const INDEX = readFileSync(join(import.meta.dirname, "..", "index.html"), "utf8");
const CONFIG = { supabase_url: "https://exemplo.supabase.co", publishable_key: "sb_publishable_exemplo" };

function assets(config: unknown = CONFIG) {
  return {
    fetch: vi.fn(async (input: Request | string) => {
      const path = new URL(typeof input === "string" ? input : input.url).pathname;
      if (path === "/og-config.json") return Response.json(config);
      if (path === "/") return new Response(INDEX, { headers: { "content-type": "text/html; charset=utf-8" } });
      return new Response("arquivo", { headers: { "content-type": "application/javascript" } });
    }),
  };
}

const profile = (fields: Record<string, string>) =>
  Response.json({ data: { slug: "ana-cortes", category: "barber", area: "Pinheiros", fields, published_at: "2026-10-20T12:00:00Z", reputation: { identity_verified: false, reviews_count: 0 } } });

const ORIGIN = "https://tinindoapp.com.br";
const DEFAULT_IMAGE = `${ORIGIN}/icons/app-icon-512.png`;
const SLOGAN = "Agenda, clientes e dinheiro do seu negócio em ordem";
const run = (path: string, fetcher: unknown, config: unknown = CONFIG, init?: RequestInit) =>
  handle(new Request(`${ORIGIN}${path}`, init), { ASSETS: assets(config) }, fetcher as typeof fetch);
const jsonLdOf = (html: string) => {
  const m = /<script type="application\/ld\+json">(.*?)<\/script>/s.exec(html);
  return m ? (JSON.parse(m[1]!) as Record<string, unknown>) : null;
};

describe("prévia do link", () => {
  it("rotas: perfil, endereço antigo do site e páginas do cliente; endereço inválido é recusado", () => {
    expect(routeOf("/p/ana-cortes")).toEqual({ kind: "profile", slug: "ana-cortes" });
    expect(routeOf("/p/Ana-Cortes/")).toEqual({ kind: "profile", slug: "ana-cortes" });
    expect(routeOf("/s/ana-cortes/")).toEqual({ kind: "redirect", slug: "ana-cortes" });
    expect(routeOf("/pagar")).toEqual({ kind: "payment", slug: null });
    expect(routeOf("/pagar/")).toEqual({ kind: "payment", slug: null });
    expect(routeOf("/pagar/ana-cortes")).toEqual({ kind: "payment", slug: "ana-cortes" });
    expect(routeOf("/orcamento")).toEqual({ kind: "quote", slug: null });
    expect(routeOf("/orcamento/ana-cortes")).toEqual({ kind: "quote", slug: "ana-cortes" });
    expect(routeOf("/avaliar")).toEqual({ kind: "review", slug: null });
    expect(routeOf("/avaliar/ana-cortes")).toEqual({ kind: "review", slug: "ana-cortes" });
    expect(routeOf("/reserva")).toEqual({ kind: "booking", slug: null });
    expect(routeOf("/reserva/ana-cortes/")).toEqual({ kind: "booking", slug: "ana-cortes" });
    expect(routeOf("/avaliacoes/ana-cortes")).toEqual({ kind: "reviews", slug: "ana-cortes" });
    expect(routeOf("/oferta")).toEqual({ kind: "offer", slug: null });
    // Endereço inválido: perfil, site e avaliações ficam de fora; link com token cai no texto neutro.
    for (const bad of ["/p/../segredo", "/p/a", "/p/-ana", "/p/ana_cortes", "/p/%E0%A4%A", "/p/ana%2Fcortes", "/p", "/s", "/s/x",
      "/s/Ana%20Cortes", "/avaliacoes", "/avaliacoes/x", "/oferta/ana-cortes", "/pagar/ana-cortes/extra", "/app/agenda", "/", "/pagarx"]) {
      expect(routeOf(bad), bad).toBeNull();
    }
    expect(routeOf("/pagar/%E0%A4%A")).toEqual({ kind: "payment", slug: null });
    expect(routeOf("/orcamento/<script>")).toEqual({ kind: "quote", slug: null });
  });

  it("o index.html tem o bloco padrão que o Worker troca", () => {
    expect(INDEX).toContain(OG_START);
    expect(INDEX).toContain(OG_END);
    expect(INDEX).toContain('property="og:title"');
  });

  it("perfil publicado: nome, categoria, bairro e chamada para agendar; texto escapado", async () => {
    const fetcher = vi.fn(async () => profile({ display_name: 'Ana "Cortes" <b>', bio: "Corte e barba.", booking_link: "https://x/p/ana-cortes" }));
    const res = await run("/p/ana-cortes", fetcher);
    const html = await res.text();
    expect(fetcher).toHaveBeenCalledWith("https://exemplo.supabase.co/functions/v1/network/public.profile?slug=ana-cortes", expect.objectContaining({ headers: { apikey: "sb_publishable_exemplo" } }));
    expect(html).toContain('<meta property="og:title" content="Ana &quot;Cortes&quot; &lt;b&gt;" />');
    expect(html).toContain('content="Barbearia · Pinheiros. Corte e barba. Veja os horários livres e agende pelo link."');
    expect(html).toContain('<meta property="og:url" content="https://tinindoapp.com.br/p/ana-cortes" />');
    expect(html).toContain(`<meta property="og:image" content="${DEFAULT_IMAGE}" />`);
    expect(html.match(/og:title/g)).toHaveLength(1);
    expect(html).not.toContain(SLOGAN);
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");
  });

  it("perfil sem link de agenda: \"na Tinindo\"", async () => {
    const html = await (await run("/p/ana-cortes", vi.fn(async () => profile({ display_name: "Ana" })))).text();
    expect(html).toContain('content="Barbearia · Pinheiros. Veja o perfil na Tinindo."');
    expect(html).not.toContain("no Tinindo");
  });

  it("perfil: canonical e JSON-LD só com o que o dono publicou", async () => {
    const html = await (await run("/p/ana-cortes?utm=x", vi.fn(async () => profile({ display_name: "Barbearia do Léo", bio: "Corte e barba." })))).text();
    expect(html).toContain('<link rel="canonical" href="https://tinindoapp.com.br/p/ana-cortes" />');
    expect(html).not.toContain('name="robots"');
    expect(jsonLdOf(html)).toEqual({
      "@context": "https://schema.org", "@type": "HairSalon", name: "Barbearia do Léo", url: "https://tinindoapp.com.br/p/ana-cortes",
      description: "Corte e barba.", areaServed: "Pinheiros",
    });
    // Bloco inteiro dentro dos marcadores, antes do </head>.
    expect(html.indexOf("application/ld+json")).toBeGreaterThan(html.indexOf(OG_START));
    expect(html.indexOf("application/ld+json")).toBeLessThan(html.indexOf(OG_END));
  });

  it("JSON-LD: tipo por categoria, foto e endereço só quando vêm na leitura pública; nada de nota ou horário", async () => {
    const photo = "https://exemplo.supabase.co/storage/v1/object/public/profile-photos/a/b.webp";
    const data = (category: string, fields: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
      vi.fn(async () => Response.json({ data: { slug: "ana-cortes", category, area: null, fields, reputation: { reviews_count: 12, average: 4.9 }, ...extra } }));
    let ld = jsonLdOf(await (await run("/p/ana-cortes", data("personal_trainer", { display_name: "Treino da Bia", address: "Rua A, 10", opening_hours: "Seg a sex, 9h às 18h" }, { photo: { url: photo } }))).text())!;
    expect(ld).toEqual({ "@context": "https://schema.org", "@type": "LocalBusiness", name: "Treino da Bia", url: "https://tinindoapp.com.br/p/ana-cortes", image: photo, address: "Rua A, 10" });
    ld = jsonLdOf(await (await run("/p/ana-cortes", data("hairdresser", { display_name: "Studio Bia", address: 42 }))).text())!;
    expect(ld["@type"]).toBe("HairSalon");
    for (const key of ["address", "image", "description", "areaServed", "aggregateRating", "openingHours"]) expect(ld).not.toHaveProperty(key);
    ld = jsonLdOf(await (await run("/p/ana-cortes", data("inventada", {}))).text())!;
    expect(ld).toMatchObject({ "@type": "LocalBusiness", name: "Serviços" });
  });

  it("nome hostil não fecha a tag nem o script", async () => {
    const name = `Léo</script><script>alert(1)</script>"><img src=x> &\u2028cia`;
    const hostile = vi.fn(async () => profile({ display_name: name, bio: "</script><b>" }));
    for (const path of ["/p/ana-cortes", "/pagar/ana-cortes", "/avaliacoes/ana-cortes"]) {
      const html = await (await run(path, hostile)).text();
      const block = html.slice(html.indexOf(OG_START), html.indexOf(OG_END));
      expect(block).not.toContain("alert(1)</script>");
      expect(block).not.toContain("<img");
      expect(block).not.toContain('"><');
      expect(block).not.toContain("\u2028");
      expect(block.match(/<script/g) ?? []).toHaveLength(path.startsWith("/p/") ? 1 : 0);
      expect(block.match(/<\/script>/g) ?? []).toHaveLength(path.startsWith("/p/") ? 1 : 0);
      expect(block).toContain("Léo&lt;/script&gt;");
    }
    const ld = jsonLdOf(await (await run("/p/ana-cortes", hostile)).text())!;
    expect(ld.name).toBe(name);
    expect(ld.description).toBe("</script><b>");
    expect(renderTags({ title: "a", description: "b", url: "c", image: "d", jsonLd: { x: "<!--&>" } })).toContain('{"x":"\\u003c!--\\u0026\\u003e"}');
  });

  it("perfil com foto: og:image é a foto (800 px); foto fora do bucket do perfil fica com a imagem padrão", async () => {
    const url = "https://exemplo.supabase.co/storage/v1/object/public/profile-photos/10000000-0000-4000-8000-00000000000a/5f0c3b6e-1d2a-4c3b-9e8f-0a1b2c3d4e5f.webp";
    const withPhoto = (photoUrl: string) => vi.fn(async () => Response.json({ data: {
      slug: "ana-cortes", category: "barber", area: "Pinheiros", fields: { display_name: "Ana" }, published_at: "2026-10-20T12:00:00Z",
      reputation: { identity_verified: false, reviews_count: 0 }, photo: { url: photoUrl, alt: "Foto de Ana" }, whatsapp_e164: null,
    } }));
    for (const path of ["/p/ana-cortes", "/pagar/ana-cortes"]) {
      let html = await (await run(path, withPhoto(url))).text();
      expect(html).toContain(`<meta property="og:image" content="${url}" />`);
      expect(html).toContain('<meta property="og:image:width" content="800" />');
      expect(html).toContain('<meta property="og:image:height" content="800" />');
      html = await (await run(path, withPhoto("https://evil.example/x.webp"))).text();
      expect(html).toContain(`<meta property="og:image" content="${DEFAULT_IMAGE}" />`);
      expect(html).toContain('<meta property="og:image:width" content="512" />');
      expect(html).not.toContain("evil.example");
    }
  });

  it("/s/:slug: 301 para /p/:slug com a mesma query, sem tocar nos arquivos nem na rede", async () => {
    const env = { ASSETS: assets() };
    const fetcher = vi.fn();
    for (const method of ["GET", "HEAD"]) {
      const res = await handle(new Request(`${ORIGIN}/s/Studio-Bia/?utm_source=bio&x=1`, { method }), env, fetcher as unknown as typeof fetch);
      expect(res.status).toBe(301);
      expect(res.headers.get("location")).toBe(`${ORIGIN}/p/studio-bia?utm_source=bio&x=1`);
    }
    expect((await handle(new Request(`${ORIGIN}/s/studio-bia`), env, fetcher as unknown as typeof fetch)).headers.get("location")).toBe(`${ORIGIN}/p/studio-bia`);
    expect(env.ASSETS.fetch).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
    // Endereço inválido não redireciona: segue para o app.
    expect((await handle(new Request(`${ORIGIN}/s/x`), env, fetcher as unknown as typeof fetch)).status).toBe(200);
  });

  const NAMED = [
    ["/pagar/ana-cortes", "Pagamento · Barbearia do Léo", "Barbearia do Léo enviou um link de pagamento. Abra para ver o valor e o prazo.", true],
    ["/orcamento/ana-cortes", "Orçamento · Barbearia do Léo", "Barbearia do Léo enviou um orçamento. Abra para ver os itens e responder.", true],
    ["/avaliar/ana-cortes", "Avalie seu atendimento · Barbearia do Léo", "Conte como foi seu atendimento com Barbearia do Léo. Leva um minuto.", true],
    ["/reserva/ana-cortes", "Sua reserva · Barbearia do Léo", "Veja o dia, a hora e o local da sua reserva com Barbearia do Léo.", true],
    ["/avaliacoes/ana-cortes", "Avaliações de Barbearia do Léo", "Veja o que clientes atendidos dizem sobre Barbearia do Léo.", false],
  ] as const;
  const NEUTRAL = [
    ["/pagar", "Link de pagamento", "Você recebeu um link de pagamento de um profissional que usa a Tinindo. Abra para ver o valor e o prazo.", true],
    ["/orcamento", "Orçamento", "Você recebeu um orçamento de um profissional que usa a Tinindo. Abra para ver os itens e responder.", true],
    ["/avaliar", "Avalie seu atendimento", "Conte como foi seu atendimento com um profissional que usa a Tinindo. Leva um minuto.", true],
    ["/reserva", "Sua reserva", "Veja o dia, a hora e o local da sua reserva com um profissional que usa a Tinindo.", true],
    ["/oferta", "Um horário abriu para você", "Um profissional que usa a Tinindo ofereceu um horário para você. Abra para ver e responder.", true],
    ["/avaliacoes/ana-cortes", "Avaliações", "Veja o que clientes atendidos dizem sobre este profissional na Tinindo.", false],
  ] as const;

  function expectCustomerTags(html: string, path: string, title: string, description: string, noindex: boolean) {
    expect(html).toContain(`<title>${title}</title>`);
    expect(html).toContain(`<meta property="og:title" content="${title}" />`);
    expect(html).toContain(`<meta name="description" content="${description}" />`);
    expect(html).toContain(`<meta property="og:description" content="${description}" />`);
    expect(html).toContain(`<meta property="og:url" content="${ORIGIN}${path}" />`);
    expect(html).toContain(`<meta property="og:image" content="${DEFAULT_IMAGE}" />`);
    expect(html).toContain('<meta property="og:image:width" content="512" />');
    expect(html).toContain('<meta property="og:image:height" content="512" />');
    expect(html.includes('<meta name="robots" content="noindex" />')).toBe(noindex);
    expect(html).not.toContain('rel="canonical"');
    expect(html).not.toContain("application/ld+json");
    expect(html).not.toContain(SLOGAN);
    expect(html.match(/og:title/g)).toHaveLength(1);
  }

  it.each(NAMED)("%s com perfil publicado: prévia com o nome do negócio", async (path, title, description, noindex) => {
    const fetcher = vi.fn(async () => profile({ display_name: "Barbearia do Léo", bio: "Corte e barba." }));
    const res = await run(`${path}?x=1`, fetcher);
    expect(fetcher).toHaveBeenCalledWith("https://exemplo.supabase.co/functions/v1/network/public.profile?slug=ana-cortes", expect.anything());
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");
    expectCustomerTags(await res.text(), path, title, description, noindex);
  });

  it.each(NEUTRAL)("%s sem perfil: texto neutro para o cliente, sem rede quando não há endereço", async (path, title, description, noindex) => {
    const fetcher = vi.fn(async () => new Response("{}", { status: 404 }));
    const res = await run(path, fetcher);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");
    expectCustomerTags(await res.text(), path, title, description, noindex);
    expect(fetcher).toHaveBeenCalledTimes(path.endsWith("/ana-cortes") ? 1 : 0);
  });

  it("link com endereço: perfil fora do ar, sem nome, erro de rede, resposta torta ou sem Supabase caem no texto neutro", async () => {
    const [, title, description] = NEUTRAL[0];
    const cases: [unknown, unknown][] = [
      [vi.fn(async () => new Response("{}", { status: 404 })), CONFIG],
      [vi.fn(async () => profile({})), CONFIG],
      [vi.fn(async () => { throw new Error("rede"); }), CONFIG],
      [vi.fn(async () => new Response("<html>", { status: 200 })), CONFIG],
      [vi.fn(async () => Response.json(null)), CONFIG],
      [vi.fn(), { supabase_url: null, publishable_key: null }],
      [vi.fn(), "isto não é configuração"],
    ];
    for (const [fetcher, config] of cases) {
      const res = await run("/pagar/ana-cortes", fetcher, config);
      expect(res.status).toBe(200);
      expectCustomerTags(await res.text(), "/pagar/ana-cortes", title, description, true);
    }
    expect(cases[5]![0]).not.toHaveBeenCalled();
    // Sem o arquivo de configuração no build.
    const env = { ASSETS: { fetch: vi.fn(async (input: Request | string) => new URL(typeof input === "string" ? input : input.url).pathname === "/"
      ? new Response(INDEX, { headers: { "content-type": "text/html" } }) : new Response("", { status: 404 })) } };
    expectCustomerTags(await (await handle(new Request(`${ORIGIN}/pagar/ana-cortes`), env, vi.fn() as unknown as typeof fetch)).text(), "/pagar/ana-cortes", title, description, true);
  });

  it("perfil fora do ar, erro de rede ou demonstração sem Supabase: padrão genérico, sem quebrar a página", async () => {
    const notFound = vi.fn(async () => new Response("{}", { status: 404 }));
    const down = vi.fn(async () => { throw new Error("rede"); });
    for (const [fetcher, config] of [[notFound, CONFIG], [down, CONFIG], [notFound, { supabase_url: null, publishable_key: null }]] as const) {
      const res = await run("/p/ana-cortes", fetcher, config);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe(INDEX);
    }
  });

  it("outras rotas, arquivos e outros métodos passam direto", async () => {
    const fetcher = vi.fn();
    let res = await run("/assets/app.js", fetcher);
    expect(await res.text()).toBe("arquivo");
    res = await run("/", fetcher);
    expect(await res.text()).toBe(INDEX);
    res = await run("/pagar", fetcher, CONFIG, { method: "POST" });
    expect(await res.text()).toBe("arquivo");
    res = await run("/s/ana-cortes", fetcher, CONFIG, { method: "POST" });
    expect(res.status).toBe(200);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("injectTags sem marcadores não mexe no HTML", () => {
    expect(injectTags("<html></html>", { title: "a", description: "b", url: "c", image: "d" })).toBe("<html></html>");
  });
});
