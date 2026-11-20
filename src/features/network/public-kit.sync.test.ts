// O kit das páginas do cliente é copiado em quatro módulos (o lint não deixa módulo importar módulo). Este teste lê os
// arquivos do disco, sem importar nada, e falha se alguma cópia divergir da de network.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("public-kit: cópias idênticas", () => {
  for (const file of ["public-kit.tsx", "public-kit.css"]) {
    for (const mod of ["payments", "sales", "reputation"]) {
      it(`${mod}/${file} é igual a network/${file}`, () => {
        expect(read(`../${mod}/${file}`)).toBe(read(`./${file}`));
      });
    }
  }
  it("owner-slug.ts é igual em payments e sales", () => {
    expect(read("../sales/owner-slug.ts")).toBe(read("../payments/owner-slug.ts"));
  });
});
