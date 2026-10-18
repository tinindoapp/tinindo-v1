import { describe, expect, it } from "vitest";
import { endOfLocalDayExclusive, formatBps, parsePercent } from "./format.ts";

describe("formatos de preço", () => {
  it("percentual em basis points, sem aceitar texto ambíguo", () => {
    expect(parsePercent("15")).toBe(1500);
    expect(parsePercent("12,5%")).toBe(1250);
    expect(parsePercent("")).toBe(0);
    expect(parsePercent("1,2,3")).toBeUndefined();
    expect(parsePercent("10%%")).toBe(1000);
    expect(parsePercent("101")).toBeUndefined();
    expect(formatBps(1250)).toBe("12,5%");
  });

  it("validade termina no início do dia seguinte no fuso do negócio", () => {
    expect(endOfLocalDayExclusive("2026-12-31", "America/Sao_Paulo")).toBe("2027-01-01T03:00:00.000Z");
  });
});
