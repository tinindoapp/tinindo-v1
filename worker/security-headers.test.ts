// P57 · cabeçalhos de segurança: toda resposta do Worker (página com prévia, arquivo, redirecionamento e queda segura)
// sai com CSP, frame-ancestors, referrer e nosniff; o `_headers` dos estáticos sai da mesma fonte.
/// <reference types="node" />
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { handle } from "./index.ts";
import { contentSecurityPolicy, headersFile, securityHeaders } from "./security-headers.ts";

const INDEX = readFileSync(join(import.meta.dirname, "..", "index.html"), "utf8");
const env = (fail = false) => ({
  ASSETS: {
    fetch: vi.fn(async (input: Request | string) => {
      if (fail) throw new Error("sem arquivos");
      const path = new URL(typeof input === "string" ? input : input.url).pathname;
      if (path === "/og-config.json") return Response.json({ supabase_url: null, publishable_key: null });
      if (path === "/") return new Response(INDEX, { headers: { "content-type": "text/html; charset=utf-8" } });
      return new Response("x", { headers: { "content-type": "application/javascript", "x-content-type-options": "trocado" } });
    }),
  },
});
const directives = (csp: string) => Object.fromEntries(csp.split("; ").map((d) => { const [k, ...v] = d.split(" "); return [k!, v]; }));

describe("cabeçalhos de segurança do Worker", () => {
  it.each([
    ["perfil com prévia", "/p/ana-cortes"],
    ["arquivo estático", "/assets/app.js"],
    ["redirecionamento do endereço antigo", "/s/ana-cortes"],
  ])("%s: CSP, frame-ancestors, referrer, nosniff", async (_n, path) => {
    const res = await handle(new Request(`https://tinindoapp.com.br${path}`), env(), vi.fn(async () => new Response("{}", { status: 404 })) as unknown as typeof fetch);
    const csp = directives(res.headers.get("content-security-policy")!);
    expect(csp["frame-ancestors"]).toEqual(["'none'"]);
    expect(csp["script-src"]).toEqual(["'self'"]);
    expect(csp["object-src"]).toEqual(["'none'"]);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
  });

  it("o redirecionamento continua 301 com o destino; o cabeçalho do arquivo é substituído, não duplicado", async () => {
    const r = await handle(new Request("https://tinindoapp.com.br/s/ana?x=1"), env());
    expect(r.status).toBe(301);
    expect(r.headers.get("location")).toBe("https://tinindoapp.com.br/p/ana?x=1");
    const a = await handle(new Request("https://tinindoapp.com.br/assets/app.js"), env());
    expect(a.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await a.text()).toBe("x");
  });

  it("CSP: só o próprio domínio para script; Supabase só em conexão e imagem; sem unsafe-eval", () => {
    const csp = directives(contentSecurityPolicy({ supabase_url: "https://abcd.supabase.co" }));
    expect(csp["connect-src"]).toEqual(["'self'", "https://*.supabase.co", "https://abcd.supabase.co", "wss://*.supabase.co", "wss://abcd.supabase.co"]);
    expect(csp["img-src"]).toEqual(["'self'", "data:", "blob:", "https://*.supabase.co", "https://abcd.supabase.co"]);
    expect(contentSecurityPolicy()).not.toMatch(/unsafe-eval/);
    expect(directives(contentSecurityPolicy())["script-src"]).not.toContain("'unsafe-inline'");
    // URL local (http) não entra: em produção o Supabase é https.
    expect(contentSecurityPolicy({ supabase_url: "http://127.0.0.1:54321" })).not.toContain("127.0.0.1");
  });

  it("o HTML do build não precisa de script inline (a CSP sem unsafe-inline não quebra a página)", () => {
    const inline = [...INDEX.matchAll(/<script(?![^>]*\bsrc=)(?![^>]*application\/ld\+json)[^>]*>/g)];
    expect(inline).toHaveLength(0);
  });

  it("_headers dos estáticos sai da mesma fonte", () => {
    const file = headersFile();
    expect(file.split("\n")[1]).toBe("/*");
    for (const [k, v] of Object.entries(securityHeaders())) expect(file).toContain(`  ${k}: ${v}`);
  });
});
