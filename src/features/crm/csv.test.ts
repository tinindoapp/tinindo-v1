import { describe, expect, it } from "vitest";
import { parseCsv, readCustomerCsv } from "./csv.ts";

describe("parseCsv", () => {
  it("lê vírgula, aspas com separador e aspas escapadas", () => {
    expect(parseCsv('nome,obs\n"Silva, Ana","disse ""oi"""\n')).toEqual([
      ["nome", "obs"],
      ["Silva, Ana", 'disse "oi"'],
    ]);
  });

  it("detecta ponto e vírgula do Excel brasileiro, BOM e CRLF", () => {
    expect(parseCsv("﻿nome;telefone\r\nAna;11 98765-4321\r\n")).toEqual([
      ["nome", "telefone"],
      ["Ana", "11 98765-4321"],
    ]);
  });
});

describe("readCustomerCsv", () => {
  const csv = [
    "Nome;Celular;E-mail;Origem;Aniversário",
    "Ana Lima;(11) 98765-4321;ANA@exemplo.test;Indicação;01/02",
    ";11 91111-0000;;;",
    "Bruno;1199;;;",
    "Carla;11 98765-4321;;;",
    ";;;;",
    "Davi;;davi@;;",
  ].join("\n");

  it("mapeia cabeçalhos em português, normaliza e aponta problemas por linha", () => {
    const r = readCustomerCsv(csv);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ignoredColumns).toEqual(["Aniversário"]);
    expect(r.rows.map((x) => [x.line, x.problem?.reason ?? "ok"])).toEqual([
      [2, "ok"],
      [3, "NAME_REQUIRED"],
      [4, "PHONE_INVALID"],
      [5, "DUPLICATE_IN_FILE"],
      [7, "EMAIL_INVALID"],
    ]);
    expect(r.rows[0]).toMatchObject({
      name: "Ana Lima",
      phone: "+5511987654321",
      email: "ana@exemplo.test",
      declared_source: "referral",
    });
    // Telefone inválido segue como digitado: o servidor rejeita e relata a linha.
    expect(r.rows[2]?.phone).toBe("1199");
  });

  it("exige coluna de nome", () => {
    expect(readCustomerCsv("telefone\n11987654321")).toEqual({
      ok: false,
      error: "A primeira linha precisa ter uma coluna “nome”.",
    });
  });

  it("limita a 500 clientes por importação", () => {
    const big = ["nome", ...Array.from({ length: 501 }, (_, i) => `Cliente ${i}`)].join("\n");
    const r = readCustomerCsv(big);
    expect(r.ok).toBe(false);
  });

  it("arquivo só com cabeçalho é recusado", () => {
    expect(readCustomerCsv("nome\n\n").ok).toBe(false);
  });
});
