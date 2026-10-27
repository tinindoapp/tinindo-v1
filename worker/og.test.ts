// Prévia do link (E1): tags do perfil publicado no HTML, escape de texto e queda segura para o padrão.
/// <reference types="node" />
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { handle } from "./index.ts";
import { injectTags, OG_END, OG_START, routeOf } from "./og.ts";

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

describe("prévia do link", () => {
  it("só /p/:slug e /s/:slug com endereço válido", () => {
    expect(routeOf("/p/ana-cortes")).toEqual({ kind: "profile", slug: "ana-cortes" });
    expect(routeOf("/s/ana-cortes/")).toEqual({ kind: "site", slug: "ana-cortes" });
    expect(routeOf("/p/../segredo")).toBeNull();
    expect(routeOf("/app/agenda")).toBeNull();
  });

  it("o index.html tem o bloco padrão que o Worker troca", () => {
    expect(INDEX).toContain(OG_START);
    expect(INDEX).toContain(OG_END);
    expect(INDEX).toContain('property="og:title"');
  });

  it("perfil publicado: nome, categoria, bairro e chamada para agendar; texto escapado", async () => {
    const fetcher = vi.fn(async () => profile({ display_name: 'Ana "Cortes" <b>', bio: "Corte e barba.", booking_link: "https://x/p/ana-cortes" }));
    const res = await handle(new Request("https://tinindoapp.com.br/p/ana-cortes"), { ASSETS: assets() }, fetcher as unknown as typeof fetch);
    const html = await res.text();
    expect(fetcher).toHaveBeenCalledWith("https://exemplo.supabase.co/functions/v1/network/public.profile?slug=ana-cortes", expect.objectContaining({ headers: { apikey: "sb_publishable_exemplo" } }));
    expect(html).toContain('<meta property="og:title" content="Ana &quot;Cortes&quot; &lt;b&gt;" />');
    expect(html).toContain('content="Barbearia · Pinheiros. Corte e barba. Veja os horários livres e agende pelo link."');
    expect(html).toContain('<meta property="og:url" content="https://tinindoapp.com.br/p/ana-cortes" />');
    expect(html).toContain('content="https://tinindoapp.com.br/icons/app-icon-512.png"');
    expect(html.match(/og:title/g)).toHaveLength(1);
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");
  });

  it("site publicado lê presence.public_site", async () => {
    const fetcher = vi.fn(async () => Response.json({ data: { site: { display_name: "Studio Bia", category: "hairdresser", area: "Centro", headline: "Cor e corte", bio: null } } }));
    const res = await handle(new Request("https://tinindoapp.com.br/s/studio-bia"), { ASSETS: assets() }, fetcher as unknown as typeof fetch);
    const html = await res.text();
    expect(html).toContain('<meta property="og:title" content="Studio Bia" />');
    expect(html).toContain("Cabeleireiro(a) · Centro. Cor e corte.");
  });

  it("perfil fora do ar, erro de rede ou demonstração sem Supabase: padrão genérico, sem quebrar a página", async () => {
    const notFound = vi.fn(async () => new Response("{}", { status: 404 }));
    const down = vi.fn(async () => { throw new Error("rede"); });
    for (const [fetcher, config] of [[notFound, CONFIG], [down, CONFIG], [notFound, { supabase_url: null, publishable_key: null }]] as const) {
      const res = await handle(new Request("https://tinindoapp.com.br/p/ana-cortes"), { ASSETS: assets(config) }, fetcher as unknown as typeof fetch);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe(INDEX);
    }
  });

  it("outras rotas e arquivos passam direto", async () => {
    const env = { ASSETS: assets() };
    const fetcher = vi.fn();
    const res = await handle(new Request("https://tinindoapp.com.br/assets/app.js"), env, fetcher as unknown as typeof fetch);
    expect(await res.text()).toBe("arquivo");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("injectTags sem marcadores não mexe no HTML", () => {
    expect(injectTags("<html></html>", { title: "a", description: "b", url: "c", image: "d" })).toBe("<html></html>");
  });
});
