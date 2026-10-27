// Tokens usados no CSS precisam existir (auditoria de UX, item 1): `var(--tn-x)` sem definição cai no valor de
// reserva ou em nada, e o texto fica ilegível no tema escuro (#555 sobre #1C1C1A = 2,29:1). Também proíbe
// `var(--tn-x, reserva)`: a reserva esconde o erro e não acompanha o tema.
/// <reference types="node" />
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// O Vitest não entrega CSS com `?raw` (o processamento de CSS fica desligado): lê do disco.
const ROOT = join(import.meta.dirname, "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const brandTokens = read("brand/tokens/tokens.css");
const SOURCES: Record<string, string> = Object.fromEntries(
  readdirSync(join(ROOT, "src"), { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".css"))
    .map((f) => {
      const path = relative(ROOT, join(ROOT, "src", f)).split("\\").join("/");
      return [path, read(path)];
    }),
);

/** Reservas que ainda existem em arquivos de outros pacotes (fora desta mudança). Remover daqui ao corrigir. */
const PENDING_FALLBACKS = new Set([
  "src/features/analytics/analytics.css: var(--tn-font-size-md, 1rem)",
  "src/features/scheduling/scheduling.css: var(--tn-tabbar-h, 64px)",
]);

const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

function defined(): Set<string> {
  const names = new Set<string>();
  for (const css of [brandTokens, ...Object.values(SOURCES)]) {
    for (const m of stripComments(css).matchAll(/(--tn-[a-z0-9-]+)\s*:/g)) names.add(m[1]!);
  }
  return names;
}

describe("tokens de CSS", () => {
  it("encontra os arquivos de CSS do app", () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(10);
    expect(brandTokens).toContain("--tn-text-muted:");
  });

  it("todo var(--tn-*) usado está definido em brand/tokens/tokens.css ou em outro CSS do src", () => {
    const names = defined();
    const missing: string[] = [];
    for (const [file, css] of Object.entries(SOURCES)) {
      for (const m of stripComments(css).matchAll(/var\(\s*(--tn-[a-z0-9-]+)/g)) {
        if (!names.has(m[1]!)) missing.push(`${file}: ${m[1]}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("nenhum var(--tn-*) tem valor de reserva", () => {
    const found: string[] = [];
    for (const [file, css] of Object.entries(SOURCES)) {
      for (const m of stripComments(css).matchAll(/var\(\s*(--tn-[a-z0-9-]+)\s*,\s*([^)]*)\)/g)) {
        found.push(`${file}: var(${m[1]}, ${m[2]!.trim()})`);
      }
    }
    expect(found.filter((f) => !PENDING_FALLBACKS.has(f))).toEqual([]);
    // A lista de pendentes só encolhe: item corrigido sai dela.
    expect([...PENDING_FALLBACKS].filter((p) => !found.includes(p))).toEqual([]);
  });
});
