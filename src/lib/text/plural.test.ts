import { describe, expect, it } from "vitest";
import { plural, pluralWord } from "./plural.ts";

describe("plural (item 58)", () => {
  it("singular só com 1; zero e outros números no plural", () => {
    expect(plural(1, "cliente")).toBe("1 cliente");
    expect(plural(0, "cliente")).toBe("0 clientes");
    expect(plural(2, "cliente")).toBe("2 clientes");
    expect(plural(-1, "dia")).toBe("-1 dia");
  });
  it("plural irregular e frases", () => {
    expect(plural(1, "nota válida", "notas válidas")).toBe("1 nota válida");
    expect(plural(3, "nota válida", "notas válidas")).toBe("3 notas válidas");
    expect(plural(2, "decisão medida", "decisões medidas")).toBe("2 decisões medidas");
    expect(pluralWord(1, "falhou", "falharam")).toBe("falhou");
  });
  it("número no formato pt-BR", () => {
    expect(plural(1234, "envio")).toBe("1.234 envios");
  });
});
