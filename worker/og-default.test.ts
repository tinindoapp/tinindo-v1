import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { absolutizeOgImage } from "./og-default.ts";

const html = readFileSync(resolve(process.cwd(), "index.html"), "utf8");
const jsonc = (file: string) =>
  JSON.parse(readFileSync(resolve(process.cwd(), file), "utf8").replace(/^\s*\/\/.*$/gm, "")) as {
    assets: { run_worker_first: string[] };
  };

describe("prévia padrão do index.html (recado #119)", () => {
  it("imagem própria 1200 × 630 declarada, em cartão grande (D24)", () => {
    expect(html).toContain('<meta property="og:image" content="/og/previa.png" />');
    expect(html).toContain('<meta property="og:image:width" content="1200" />');
    expect(html).toContain('<meta property="og:image:height" content="630" />');
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image" />');
  });

  it("a imagem existe em public/ e é PNG de 1200 × 630", () => {
    const png = readFileSync(resolve(process.cwd(), "public/og/previa.png"));
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630]);
    expect(png.length).toBeLessThan(300 * 1024);
  });

  it("com VITE_PUBLIC_ORIGIN a imagem fica absoluta; sem ele ou inválido, fica como está", () => {
    expect(absolutizeOgImage(html, "https://homolog.tinindoapp.com.br/")).toContain(
      '<meta property="og:image" content="https://homolog.tinindoapp.com.br/og/previa.png" />',
    );
    expect(absolutizeOgImage(html, undefined)).toBe(html);
    expect(absolutizeOgImage(html, "")).toBe(html);
    expect(absolutizeOgImage(html, "http://inseguro.test")).toBe(html);
    expect(absolutizeOgImage(html, 'https://x.test" onload="')).toBe(html);
  });
});

describe("run_worker_first (recado #119)", () => {
  const prod = jsonc("wrangler.jsonc").assets.run_worker_first;
  it("produção e homologação iguais", () => {
    expect(jsonc("wrangler.homolog.jsonc").assets.run_worker_first).toEqual(prod);
  });
  it("cobre o perfil e as páginas do cliente final", () => {
    for (const path of ["/p/*", "/s/*", "/pagar/*", "/orcamento/*", "/avaliar/*", "/reserva/*", "/avaliacoes/*", "/oferta"]) {
      expect(prod).toContain(path);
    }
  });
});
