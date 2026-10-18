import { describe, expect, it } from "vitest";
import { formatCents, formatPhone, normalizePhoneBR, parseBRL, parsePercentToBps, sourceFromText } from "./format.ts";

describe("normalizePhoneBR", () => {
  it.each([
    ["(11) 98765-4321", "+5511987654321"],
    ["11 3456-7890", "+551134567890"],
    ["011 98765-4321", "+5511987654321"],
    ["55 11 98765 4321", "+5511987654321"],
    ["+351 912 345 678", "+351912345678"],
    ["00351912345678", "+351912345678"],
  ])("%s → %s", (raw, e164) => {
    expect(normalizePhoneBR(raw)).toEqual({ value: e164 });
  });

  it("vazio vira null", () => {
    expect(normalizePhoneBR("  ")).toEqual({ value: null });
  });

  it.each(["1199", "98765-4321", "telefone", "+0 11 9999", "11 98765-4321 ramal 2"])("%s é inválido", (raw) => {
    expect(normalizePhoneBR(raw)).toEqual({ error: "PHONE_INVALID" });
  });

  it("formata +55 no padrão local", () => {
    expect(formatPhone("+5511987654321")).toBe("(11) 98765-4321");
    expect(formatPhone("+351912345678")).toBe("+351912345678");
  });
});

describe("dinheiro sem float", () => {
  it.each([
    ["60", 6000],
    ["60,5", 6050],
    ["60,05", 6005],
    ["1.234,56", 123456],
    ["R$ 0,10", 10],
    ["19.99", 1999],
  ])("%s → %s centavos", (raw, cents) => {
    expect(parseBRL(raw)).toBe(cents);
  });

  it("vazio → null; texto ruim → undefined", () => {
    expect(parseBRL("")).toBeNull();
    expect(parseBRL("60,555")).toBeUndefined();
    expect(parseBRL("-10")).toBeUndefined();
    expect(parseBRL("abc")).toBeUndefined();
  });

  it("percentual em basis points", () => {
    expect(parsePercentToBps("4,99")).toBe(499);
    expect(parsePercentToBps("5")).toBe(500);
    expect(parsePercentToBps("101")).toBeUndefined();
    expect(parsePercentToBps("")).toBeNull();
  });

  it("exibe em reais", () => {
    expect(formatCents(6000).replace(/\s/g, " ")).toBe("R$ 60,00");
    expect(formatCents(null)).toBe("—");
  });
});

describe("origem declarada", () => {
  it.each([
    ["Indicação", "referral"],
    ["insta", "instagram"],
    ["Passou na porta", "walk_in"],
    ["Condomínio", "condominium"],
    ["", null],
  ])("%s → %s", (raw, source) => {
    expect(sourceFromText(raw)).toBe(source);
  });

  it("texto desconhecido segue como está para o servidor rejeitar e relatar", () => {
    expect(sourceFromText("Anúncio pago")).toBe("Anúncio pago");
  });
});
