import { describe, expect, it } from "vitest";
import { formatPhone, normalizePhoneBR, phoneToE164, telHref, whatsappHref } from "./phone.ts";

// Uma tabela só para Clientes, Agenda e o link público de reserva: os três usam este analisador.
describe("normalizePhoneBR", () => {
  it.each([
    ["(11) 98765-4321", "+5511987654321"],
    ["11 3456-7890", "+551134567890"],
    ["011 98765-4321", "+5511987654321"],
    // Fixo com o 0 de longa distância (11 dígitos): a cópia da Agenda dava +5501187654321.
    ["0 11 8765-4321", "+551187654321"],
    ["55 11 98765 4321", "+5511987654321"],
    ["+55 11 97777-4343", "+5511977774343"],
    ["+351 912 345 678", "+351912345678"],
    ["00351912345678", "+351912345678"],
  ])("%s → %s", (raw, e164) => {
    expect(normalizePhoneBR(raw)).toEqual({ value: e164 });
  });

  it("vazio vira null", () => {
    expect(normalizePhoneBR("  ")).toEqual({ value: null });
  });

  // "11 9abc8765-4321": a cópia do link público apagava as letras e aceitava o número.
  it.each(["1199", "98765-4321", "telefone", "+0 11 9999", "11 98765-4321 ramal 2", "11 9abc8765-4321"])("%s é inválido", (raw) => {
    expect(normalizePhoneBR(raw)).toEqual({ error: "PHONE_INVALID" });
  });

  it("atalho de formulário: null quando vazio, undefined quando inválido", () => {
    expect(phoneToE164("011 98765-4321")).toBe("+5511987654321");
    expect(phoneToE164("")).toBeNull();
    expect(phoneToE164("abc")).toBeUndefined();
  });

  it("formata +55 no padrão local", () => {
    expect(formatPhone("+5511987654321")).toBe("(11) 98765-4321");
    expect(formatPhone("+551134567890")).toBe("(11) 3456-7890");
    expect(formatPhone("+351912345678")).toBe("+351912345678");
    expect(formatPhone(null)).toBe("");
  });

  it("links de ligar e de WhatsApp só com E.164 válido", () => {
    expect(telHref("+5511987654321")).toBe("tel:+5511987654321");
    expect(whatsappHref("+5511987654321")).toBe("https://wa.me/5511987654321");
    expect(telHref("11987654321")).toBeNull();
    expect(whatsappHref(null)).toBeNull();
  });
});
