import { describe, expect, it } from "vitest";
import { centsToInput, formatCents, parseBRL } from "./money.ts";

describe("dinheiro do app: um único leitor e um único formatador", () => {
  it("lê reais em centavos inteiros, sem float", () => {
    expect(parseBRL("60")).toBe(6000);
    expect(parseBRL("60,5")).toBe(6050);
    expect(parseBRL("1.234,56")).toBe(123456);
    expect(parseBRL("R$ 0,10")).toBe(10);
    expect(parseBRL("")).toBeNull();
    expect(parseBRL("12,345")).toBeUndefined();
    expect(parseBRL("-5")).toBeUndefined();
  });

  // A tabela da revisão de 10/11 (fe-arquitetura-01): antes, "10.50" era R$ 10,50 no Caixa e R$ 1.050,00 em Contas,
  // Materiais e Configuração; vazio virava 0, NaN ou null conforme a tela.
  it.each([
    ["10,50", 1050],
    ["10.50", 1050], // ponto sem vírgula é o decimal
    ["1.234,56", 123456],
    ["1.234", undefined], // três casas depois do ponto: ambíguo, a tela pede para corrigir
    ["R$ 60,00", 6000],
    ["abc", undefined],
    ["", null],
    ["   ", null],
    ["0,1", 10],
  ])("%j → %j", (raw, cents) => {
    expect(parseBRL(raw)).toBe(cents);
  });

  it("formata e devolve para o campo sem perder centavos", () => {
    expect(formatCents(123456)).toMatch(/1\.234,56/);
    expect(formatCents(null)).toBe("—");
    expect(formatCents(undefined)).toBe("—");
    expect(centsToInput(6050)).toBe("60,50");
    expect(centsToInput(5)).toBe("0,05");
    for (const cents of [0, 5, 1050, 123456]) expect(parseBRL(centsToInput(cents))).toBe(cents);
  });
});
