// Regras do sistema visual que o CSS dos módulos precisa seguir (auditoria de UX, onda 2, itens 8, 10, 13 e 14).
// Faz o papel de uma regra de stylelint sem dependência nova: lê todo CSS de src/ e aponta a linha que quebra a regra.
/// <reference types="node" />
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..", "..");
const FILES: Record<string, string> = Object.fromEntries(
  readdirSync(join(ROOT, "src"), { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".css"))
    .map((f) => {
      const path = relative(ROOT, join(ROOT, "src", f)).split("\\").join("/");
      return [path, readFileSync(join(ROOT, path), "utf8").replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "))];
    }),
);
const MODULES = Object.entries(FILES).filter(([f]) => f.startsWith("src/features/") || f.startsWith("src/app/"));

/** Linha (1-based) de uma posição no texto. */
const lineOf = (css: string, index: number) => css.slice(0, index).split("\n").length;

describe("sistema visual", () => {
  it("item 10: tamanho de fonte só pelos papéis --tn-text-* (sem px, rem ou escala crua nos módulos)", () => {
    const bad: string[] = [];
    for (const [file, css] of MODULES) {
      for (const m of css.matchAll(/font-size:\s*([^;}]+)/g)) {
        if (!/^var\(--tn-text-[a-z-]+\)$/.test(m[1]!.trim())) bad.push(`${file}:${lineOf(css, m.index)} ${m[1]!.trim()}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("item 10: peso por token (600 = --tn-font-weight-semibold), nunca número solto", () => {
    const bad: string[] = [];
    for (const [file, css] of MODULES) {
      for (const m of css.matchAll(/font-weight:\s*(\d+|bold)/g)) bad.push(`${file}:${lineOf(css, m.index)}`);
    }
    expect(bad).toEqual([]);
  });

  it("item 13: módulos não repetem `font: inherit` (fica em global.css, antes do tabular-nums)", () => {
    const bad: string[] = [];
    for (const [file, css] of MODULES) {
      for (const m of css.matchAll(/font:\s*inherit/g)) bad.push(`${file}:${lineOf(css, m.index)}`);
    }
    expect(bad).toEqual([]);
  });

  it("item 14: todo :hover fica dentro de @media (hover: hover)", () => {
    const bad: string[] = [];
    for (const [file, css] of Object.entries(FILES)) {
      // Percorre os blocos guardando a pilha de @media; um seletor com :hover precisa ter "(hover: hover)" na pilha.
      const stack: string[] = [];
      let start = 0;
      for (let i = 0; i < css.length; i++) {
        const ch = css[i];
        if (ch === "{") {
          const prelude = css.slice(start, i).trim();
          if (prelude.includes(":hover") && !prelude.startsWith("@") && !stack.some((s) => /\(hover:\s*hover\)/.test(s))) {
            bad.push(`${file}:${lineOf(css, start + css.slice(start, i).search(/\S/))} ${prelude.split("\n")[0]}`);
          }
          stack.push(prelude);
          start = i + 1;
        } else if (ch === "}") {
          stack.pop();
          start = i + 1;
        } else if (ch === ";") {
          start = i + 1;
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it("item 8: módulos usam os utilitários (.tn-muted, .tn-actions, .tn-stack) em vez de recriar com prefixo", () => {
    const bad: string[] = [];
    for (const [file, css] of MODULES) {
      for (const m of css.matchAll(/(^|[\s,}])(\.[a-z][a-z0-9-]*-(?:muted|actions|stack))\s*[{,]/gm)) {
        if (!m[2]!.startsWith(".tn-") || /^\.tn-(muted|actions|stack)$/.test(m[2]!)) continue;
        bad.push(`${file}:${lineOf(css, m.index)} ${m[2]}`);
      }
      for (const m of css.matchAll(/(^|[\s,}])(\.(?!tn-)[a-z][a-z0-9-]*-(?:muted|actions|stack))\s*[{,]/gm)) {
        bad.push(`${file}:${lineOf(css, m.index)} ${m[2]}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
