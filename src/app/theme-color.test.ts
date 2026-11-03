// Item 22 da auditoria de UX: a barra do navegador acompanha o tema (antes ficava preta no claro) e as cores são as
// dos tokens da marca: papel-50 no claro, tinta-950 no escuro. O manifest (sem media) usa a do claro.
/// <reference types="node" />
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const token = (name: string) => new RegExp(`--tn-color-${name}:\\s*(#[0-9A-Fa-f]{6})`).exec(read("brand/tokens/tokens.css"))![1]!.toUpperCase();

describe("theme-color (item 22)", () => {
  it("uma meta por tema, com media, nas cores da marca", () => {
    const metas = [...read("index.html").matchAll(/<meta name="theme-color" content="(#[0-9A-Fa-f]{6})"(?: media="([^"]+)")? \/>/g)];
    expect(metas.map((m) => [m[2], m[1]!.toUpperCase()])).toEqual([
      ["(prefers-color-scheme: light)", token("papel-50")],
      ["(prefers-color-scheme: dark)", token("tinta-950")],
    ]);
  });

  it("manifest: theme_color igual ao fundo claro", () => {
    const m = JSON.parse(read("public/manifest.webmanifest")) as { theme_color: string; background_color: string };
    expect(m.theme_color.toUpperCase()).toBe(token("papel-50"));
    expect(m.background_color.toUpperCase()).toBe(token("papel-50"));
  });
});
