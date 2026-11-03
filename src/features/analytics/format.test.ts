import { describe, expect, it } from "vitest";
import { deltaText, localDayStart, metricMath, metricValue, ratioMetric, trend, trendText } from "./format.ts";

describe("resultado · apresentação", () => {
  it("insuficiente e indisponível nunca viram zero", () => {
    expect(metricValue({ unit: "ratio", value: null, status: "insufficient" })).toBe("Dados insuficientes");
    expect(metricValue({ unit: "ratio", value: null, status: "unavailable" })).toBe("Ainda não medido");
    expect(metricValue({ unit: "ratio", value: 0, status: "ok" })).toBe("0%");
  });
  it("mostra a conta e a diferença em pontos percentuais", () => {
    expect(metricMath({ key: "occupancy", label: "", unit: "ratio", numerator: 120, denominator: 2940, value: 0.0408, status: "ok", note: "" }))
      .toBe("120 min de 2.940 min");
    expect(deltaText("ratio", -0.125)).toBe("−12,5 p.p.");
    expect(deltaText("cents", 6000)).toMatch(/^\+R\$\s60,00$/);
    expect(deltaText("minutes", null)).toBe("sem comparação");
  });
  it("razão igual à do banco", () => {
    expect(ratioMetric(1, 3)).toEqual({ numerator: 1, denominator: 3, value: 0.3333, status: "ok" });
    expect(ratioMetric(0, 0).status).toBe("insufficient");
  });
  it("dias civis no fuso do negócio", () => {
    expect(localDayStart(new Date("2026-10-20T12:00:00Z"), 0, "America/Sao_Paulo")).toBe("2026-10-20T03:00:00.000Z");
    expect(localDayStart(new Date("2026-10-20T12:00:00Z"), -7, "America/Sao_Paulo")).toBe("2026-10-13T03:00:00.000Z");
  });
  it("diferença com seta e palavra, sabendo quando subir é bom ou ruim (item 54)", () => {
    expect(trendText(trend("no_show", "ratio", -0.012))).toBe("▼ 1,2 p.p. · melhorou");
    expect(trendText(trend("occupancy", "ratio", -0.012))).toBe("▼ 1,2 p.p. · piorou");
    expect(trendText(trend("expenses", "cents", 6000))).toMatch(/^▲ R\$\s60,00 · piorou$/);
    expect(trendText(trend("received", "cents", 6000))).toMatch(/^▲ R\$\s60,00 · melhorou$/);
    expect(trendText(trend("leftover", "cents", 0))).toMatch(/^= R\$\s0,00 · sem mudança$/);
    expect(trendText(trend("human_minutes", "minutes", 5))).toBe("▲ 5 min");
    expect(trend("reminders", "ratio", null)).toBeNull();
    expect(trend("cancellation", "ratio", 0.05)?.spoken).toBe("subiu");
  });
});
