// T12 · CEP e endereço também nunca vão para o modelo. Casos positivos (vira marcador) e negativos (o pedido precisa
// do texto: prefixo de zona do Domicílio, horário, data, valor, duração, bairro sem logradouro).
import { describe, expect, it } from "vitest";
import { hasPii, redactPii } from "./redact.ts";

describe("CEP vira [cep]", () => {
  it.each([
    ["01310-100", "[cep]"],
    ["01310100", "[cep]"],
    ["01.310-100", "[cep]"],
    ["01.310100", "[cep]"],
    ["CEP 04538-133", "CEP [cep]"],
    ["cep: 22041001", "cep: [cep]"],
    ["(CEP 01310-100)", "(CEP [cep])"],
    ["01310-100.", "[cep]."],
    ["moro no 05424-020, perto do parque", "moro no [cep], perto do parque"],
  ])("%s → %s", (raw, out) => {
    expect(redactPii(`x ${raw} y`)).toBe(`x ${out} y`);
    expect(hasPii(raw)).toBe(true);
  });

  it("8 dígitos de CEP saem como [cep], nunca como [telefone] nem pela metade", () => {
    expect(redactPii("01310100")).toBe("[cep]");
    expect(redactPii("CEP 01310100 e telefone (11) 98765-4321")).toBe("CEP [cep] e telefone [telefone]");
  });

  it("telefone continua telefone (inclusive fixo de 8 dígitos com DDD)", () => {
    expect(redactPii("(11) 32654321")).toBe("[telefone]");
    expect(redactPii("11 32654321")).toBe("[telefone]");
    expect(redactPii("(11) 98765-4321")).toBe("[telefone]");
    expect(redactPii("3333-4444")).toBe("[telefone]");
    expect(redactPii("+55 11 987654321")).toBe("[telefone]");
  });

  it("documentos continuam documentos", () => {
    expect(redactPii("CPF 123.456.789-09")).toBe("CPF [documento]");
    expect(redactPii("12.345.678/0001-90")).toBe("[documento]");
    expect(redactPii("RG 12.345.678-9")).toBe("RG [número]");
  });
});

describe("endereço vira [endereço]", () => {
  it.each([
    ["Rua Augusta, 123", "[endereço]"],
    ["Rua Augusta 123 ap 12", "[endereço]"],
    ["rua augusta, 1500, apto 31", "[endereço]"],
    ["R. Augusta, 10", "[endereço]"],
    ["Av. Paulista, nº 1000", "[endereço]"],
    ["Av Paulista 1000 apto 31 bloco C", "[endereço]"],
    ["avenida brasil 45", "[endereço]"],
    ["Alameda Santos s/n", "[endereço]"],
    ["Al. Santos, 200, sala 4", "[endereço]"],
    ["Travessa X, 12, casa 2", "[endereço]"],
    ["Tv. do Ouvidor 5", "[endereço]"],
    ["Praça da Sé", "[endereço]"],
    ["praça da república, 10", "[endereço]"],
    ["Estrada do Campo Limpo 1234", "[endereço]"],
    ["Rodovia Anhanguera km 20", "[endereço]"],
    ["Largo do Arouche 50", "[endereço]"],
    ["Rua das Flores", "[endereço]"],
    ["rua da consolação 45, bloco B", "[endereço]"],
    ["Rua Pres. Vargas, 3", "[endereço]"],
    ["Rua Augusta, número 77", "[endereço]"],
  ])("%s → %s", (raw, out) => {
    expect(redactPii(`fica na ${raw} ok`)).toBe(`fica na ${out} ok`);
    expect(hasPii(raw)).toBe(true);
  });

  it("o resto do pedido fica: horário, duração, valor e dia depois do endereço", () => {
    expect(redactPii("Rua Augusta às 14:30")).toBe("[endereço] às 14:30");
    expect(redactPii("R. Augusta 10h")).toBe("[endereço] 10h");
    expect(redactPii("Avenida Brasil 30 min")).toBe("[endereço] 30 min");
    expect(redactPii("Rua Augusta 123 R$ 60,00")).toBe("[endereço] R$ 60,00");
    expect(redactPii("na Rua das Flores perto do metrô amanhã")).toBe("na [endereço] perto do metrô amanhã");
    expect(redactPii("moro na rua augusta.")).toBe("moro na [endereço].");
  });

  it("endereço completo com CEP: os dois marcadores", () => {
    expect(redactPii("Rua Augusta, 123, 01310-100, São Paulo")).toBe("[endereço], [cep], São Paulo");
    expect(redactPii("atendo na Av. Paulista 1000 ap 12 (CEP 01310100) às 9h"))
      .toBe("atendo na [endereço] (CEP [cep]) às 9h");
  });
});

describe("o que NÃO é CEP nem endereço fica como está", () => {
  it.each([
    "zona 01310",
    "atendo em Moema e Vila Mariana, zona 04500",
    "Moema",
    "Vila Mariana",
    "Pinheiros, Jardins e Itaim",
    "de 9h às 19h",
    "terça a sábado, 9h às 19h, pausa 12:00 às 13:00",
    "às 14:30",
    "05/11/2026",
    "2026-11-05",
    "R$ 60,00",
    "R$ 1.250,00",
    "30 min",
    "corte 45 minutos por R$ 60",
    "15% de desconto",
    "cabelo largo em cima",
    "vou pra rua hoje",
    "a estrada estava ruim",
    "marca a Maria quinta às 10h",
    "quanto recebi essa semana?",
    "sessão de 60 min, pacote com 10 aulas",
    "12345",
  ])("%s", (t) => {
    expect(redactPii(t)).toBe(t);
    expect(hasPii(t)).toBe(false);
  });
});
