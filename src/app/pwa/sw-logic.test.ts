import { describe, expect, it } from "vitest";
import { cacheNames, cachesToDelete, classify, precacheList, swVersion } from "./sw-logic.ts";

const origin = "https://app.tinindo.test";
const pre = new Set(["/", "/index.html", "/manifest.webmanifest", "/icons/app-icon-192.png"]);
const kind = (url: string, method = "GET", mode = "cors") => classify({ url, method, mode, origin }, pre);

describe("service worker: o que passa por ele (P34)", () => {
  it("navegação do app usa a casca; páginas do cliente final passam direto", () => {
    expect(kind(`${origin}/app/agenda`, "GET", "navigate")).toBe("navigation");
    expect(kind(`${origin}/entrar`, "GET", "navigate")).toBe("navigation");
    for (const p of ["/p/barbearia", "/pagar/abc", "/reserva", "/orcamento/x", "/avaliacoes/barbearia"]) {
      expect(kind(`${origin}${p}`, "GET", "navigate")).toBe("passthrough");
    }
  });

  it("arquivos com hash vêm do cache; os da lista de instalação também; o resto passa", () => {
    expect(kind(`${origin}/assets/routes-Ab12.js`)).toBe("asset");
    expect(kind(`${origin}/manifest.webmanifest`)).toBe("precached");
    expect(kind(`${origin}/version.json`)).toBe("passthrough");
    expect(kind(`${origin}/sw.js`)).toBe("passthrough");
  });

  it("Edge Functions vão sempre à rede; outra origem e outros métodos passam", () => {
    expect(kind("https://x.supabase.co/functions/v1/scheduling/booking.list", "POST")).toBe("api");
    expect(kind("https://x.supabase.co/functions/v1/context")).toBe("api");
    expect(kind("https://x.supabase.co/functions/v1/scheduling/x", "DELETE")).toBe("passthrough");
    expect(kind("https://x.supabase.co/auth/v1/token")).toBe("passthrough");
    expect(kind(`${origin}/app`, "POST", "navigate")).toBe("passthrough");
    expect(kind("https://outro.site/assets/a.js")).toBe("passthrough");
    expect(kind("não é url")).toBe("passthrough");
  });
});

describe("versões e caches", () => {
  it("versão ordenável pela hora do build", () => {
    const a = swVersion("2026-11-21T10:00:00.000Z", "abcdef1234");
    const b = swVersion("2026-11-21T11:30:00.123Z", "0000000999");
    expect(a).toBe("20261121T100000Z-abcdef1");
    expect(cacheNames(a).shell < cacheNames(b).shell).toBe(true);
  });

  it("ao ativar, fica a versão atual e a anterior; caches de fora do app não são tocados", () => {
    const v = (s: string) => cacheNames(s).shell;
    const existing = [v("20261101T000000Z-a"), v("20261110T000000Z-b"), v("20261120T000000Z-c"), v("20261121T000000Z-d"), "outro-cache"];
    expect(cachesToDelete(existing, v("20261121T000000Z-d")).sort()).toEqual([v("20261101T000000Z-a"), v("20261110T000000Z-b")]);
    expect(cachesToDelete([v("20261121T000000Z-d")], v("20261121T000000Z-d"))).toEqual([]);
  });

  it("lista de instalação: sem mapas, configuração, o próprio sw.js nem fontes de outros alfabetos", () => {
    const list = precacheList(
      ["index.html", "assets/a-1.js", "assets/a-1.js.map", "_headers", "version.json", "og-config.json", "sw.js",
        "assets/inter-latin-opsz-normal-x.woff2", "assets/inter-cyrillic-opsz-normal-y.woff2"],
      ["manifest.webmanifest", "og/previa.png", "icons/app-icon-192.png"],
    );
    expect(list).toEqual(["/", "/assets/a-1.js", "/assets/inter-latin-opsz-normal-x.woff2", "/icons/app-icon-192.png", "/index.html", "/manifest.webmanifest"]);
  });
});
