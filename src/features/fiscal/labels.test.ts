import { describe, expect, it } from "vitest";
import { formatMonthName } from "./labels.ts";

describe("notas · datas no padrão pt-BR (item 58)", () => {
  it("mês por extenso, sem data crua nem maiúscula no meio", () => {
    expect(formatMonthName("2026-10")).toBe("outubro de 2026");
    expect(formatMonthName("2026-01-01")).toBe("janeiro de 2026");
  });
});
