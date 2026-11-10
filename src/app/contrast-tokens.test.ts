// Contraste dos tokens semânticos nos dois temas (revisão de 10/11, achados design-cores-tema-02, -04 e -05).
// Resolve cada --tn-* como o navegador: brand/tokens/tokens.css e, por cima, src/styles/global.css (claro em `:root`,
// escuro em `:root[data-theme="dark"]`), seguindo var() e color-mix(in srgb, …). O contraste é o da WCAG 2.
/// <reference types="node" />
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..", "..");
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const brand = strip(readFileSync(join(ROOT, "brand/tokens/tokens.css"), "utf8"));
const global = strip(readFileSync(join(ROOT, "src/styles/global.css"), "utf8"));

/** Corpo do primeiro bloco cujo seletor é exatamente `selector`. */
function block(css: string, selector: string): string {
  const at = css.indexOf(`${selector} {`);
  if (at < 0) return "";
  let depth = 0;
  const start = css.indexOf("{", at);
  for (let i = start; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return css.slice(start + 1, i);
  }
  return "";
}
const decls = (body: string) =>
  Object.fromEntries([...body.matchAll(/(--tn-[a-z0-9-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]));

const DARK = ':root[data-theme="dark"]';
const MEDIA_DARK = ':root:not([data-theme="light"])';
const light = { ...decls(block(brand, ":root")), ...decls(block(global, ":root")) };
const dark = { ...light, ...decls(block(brand, DARK)), ...decls(block(global, DARK)) };

type Rgb = [number, number, number];
const hex = (h: string): Rgb => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb;

function resolve(value: string, theme: Record<string, string>, depth = 0): Rgb {
  if (depth > 20) throw new Error(`referência circular em ${value}`);
  const v = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(v)) return hex(v);
  const ref = /^var\((--tn-[a-z0-9-]+)\)$/.exec(v);
  if (ref) {
    const next = theme[ref[1]!];
    if (!next) throw new Error(`token não definido: ${ref[1]}`);
    return resolve(next, theme, depth + 1);
  }
  const mix = /^color-mix\(in srgb,\s*(var\([^)]+\))\s+(\d+)%,\s*(var\([^)]+\))\)$/.exec(v);
  if (mix) {
    const a = resolve(mix[1]!, theme, depth + 1);
    const b = resolve(mix[3]!, theme, depth + 1);
    const p = Number(mix[2]) / 100;
    return a.map((c, i) => Math.round(c * p + b[i]! * (1 - p))) as Rgb;
  }
  throw new Error(`valor que o teste não sabe resolver: ${v}`);
}

const luminance = (rgb: Rgb) => {
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: Rgb, b: Rgb) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};
const contrast = (fg: string, bg: string, theme: Record<string, string>) => ratio(resolve(`var(${fg})`, theme), resolve(`var(${bg})`, theme));

const THEMES = { claro: light, escuro: dark };
const TONES = ["success", "warning", "danger", "info"] as const;

describe("contraste dos tokens (tema claro e escuro)", () => {
  for (const [name, theme] of Object.entries(THEMES)) {
    it.each(TONES)(`${name}: selo de estado %s tem fundo próprio e texto a 4,5:1 ou mais`, (tone) => {
      expect(contrast(`--tn-${tone}-text`, `--tn-${tone}-bg`, theme)).toBeGreaterThanOrEqual(4.5);
      // O fundo do selo não pode ser a cor do cartão: a pílula precisa aparecer (no claro, de 1,13:1 no âmbar para cima;
      // antes, no escuro, 1,00:1).
      expect(contrast(`--tn-${tone}-bg`, "--tn-surface", theme)).toBeGreaterThanOrEqual(1.1);
    });

    it(`${name}: texto de exemplo dos campos (::placeholder) a 4,5:1 ou mais sobre o campo`, () => {
      const rule = /::placeholder\s*\{([^}]*)\}/.exec(global);
      expect(rule, "global.css precisa de uma regra ::placeholder").not.toBeNull();
      const color = /color:\s*var\((--tn-[a-z0-9-]+)\)/.exec(rule![1]!)?.[1];
      expect(color).toBeDefined();
      expect(rule![1]).toMatch(/opacity:\s*1/);
      expect(contrast(color!, "--tn-surface", theme)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(color!, "--tn-bg", theme)).toBeGreaterThanOrEqual(4.5);
    });

    it(`${name}: barra de medida nativa (<meter>) pinta trilho e preenchimento com tokens`, () => {
      const fill = /meter::-webkit-meter-optimum-value[^{]*\{[^}]*background:\s*var\((--tn-[a-z0-9-]+)\)/.exec(global)?.[1];
      const moz = /meter::-moz-meter-bar\s*\{[^}]*background:\s*var\((--tn-[a-z0-9-]+)\)/.exec(global)?.[1];
      const track = /meter::-webkit-meter-bar\s*\{[^}]*background:\s*var\((--tn-[a-z0-9-]+)\)/.exec(global)?.[1];
      expect(fill).toBeDefined();
      expect(moz).toBe(fill);
      expect(track).toBeDefined();
      expect(/(^|\n)meter\s*\{[^}]*appearance:\s*none/.test(global)).toBe(true);
      // Preenchimento contra o trilho: a ocupação precisa ser lida (3:1 para elemento gráfico).
      expect(contrast(fill!, track!, theme)).toBeGreaterThanOrEqual(3);
    });
  }

  it("o escuro automático (prefers-color-scheme) repete o escuro forçado (data-theme) nos fundos de estado", () => {
    const media = decls(block(global, MEDIA_DARK));
    const forced = decls(block(global, DARK));
    for (const tone of TONES) expect(media[`--tn-${tone}-bg`]).toBe(forced[`--tn-${tone}-bg`]);
  });
});
