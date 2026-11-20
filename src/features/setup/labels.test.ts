import { describe, expect, it } from "vitest";
import { priceRange, priceText } from "./labels.ts";

describe("preço na Configuração (formatCents da lib)", () => {
  it("sai igual ao formato que a tela montava à mão, com espaço comum", () => {
    const before = (cents: number) => `R$ ${(cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    for (const cents of [0, 5, 99, 6000, 12345, 123456, 100000000]) expect(priceText(cents)).toBe(before(cents));
    expect(priceText(123456)).toBe("R$ 1.234,56");
    expect(priceRange(4000, 10000)).toBe("R$ 40,00 a R$ 100,00");
    expect(priceRange(2500, 2500)).toBe("R$ 25,00");
    expect(priceRange(null, 2500)).toBeNull();
  });
});
