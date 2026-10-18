import { describe, expect, it } from "vitest";
import { centsToInput, effectiveStatus, explain, localToIso, parseBRL, quoteTotal, validUntilInDays } from "./rules.ts";

describe("orçamentos · regras", () => {
  it("valores em centavos, sem float", () => {
    expect(parseBRL("60")).toBe(6000);
    expect(parseBRL("60,5")).toBe(6050);
    expect(parseBRL("R$ 1.234,56")).toBe(123456);
    expect(parseBRL("12,345")).toBeNull();
    expect(parseBRL("-5")).toBeNull();
    expect(centsToInput(6050)).toBe("60,50");
    expect(quoteTotal([{ quantity: 3, unit_price_cents: 1999 }, { quantity: 1, unit_price_cents: 1 }])).toBe(5998);
  });

  it("enviado com validade vencida aparece como vencido; outros estados não mudam", () => {
    const now = new Date("2026-10-20T12:00:00Z");
    expect(effectiveStatus("sent", "2026-10-20T12:00:00Z", now)).toBe("expired");
    expect(effectiveStatus("sent", "2026-10-20T12:00:01Z", now)).toBe("sent");
    expect(effectiveStatus("accepted", "2026-10-01T00:00:00Z", now)).toBe("accepted");
  });

  it("hora local do negócio vira instante certo, inclusive validade no fim do dia", () => {
    expect(localToIso("2026-10-27", "10:00", "America/Sao_Paulo")).toBe("2026-10-27T13:00:00.000Z");
    expect(validUntilInDays(new Date("2026-10-20T12:00:00Z"), 7, "America/Sao_Paulo")).toBe("2026-10-28T02:59:59.000Z");
  });

  it("erros dizem o que não aconteceu", () => {
    expect(explain({ code: "SLOT_CONFLICT" })).toContain("Nada foi gravado");
    expect(explain({ code: "POLICY_REJECTED", field: "valid_until" })).toContain("venceu");
  });
});
