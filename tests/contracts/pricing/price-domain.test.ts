// P05 · Regra de preço em inteiros (doc06): fixtures, arredondamento e limites.
import { describe, expect, it } from "vitest";
import { computePrice, economicFloor, PRICE_FIXTURES } from "../../../supabase/functions/_shared/domain/pricing/price.ts";

describe("preço por regra (doc06)", () => {
  it.each(PRICE_FIXTURES)("$name", ({ input, final, floor, reason }) => {
    const r = computePrice(input);
    if (reason === "FLOOR_ABOVE_BASE" || reason === "MARGIN_DENOMINATOR") {
      expect(r).toMatchObject({ ok: false, error: reason });
      return;
    }
    expect(r).toMatchObject({ ok: true, final_cents: final, floor_cents: floor, reason });
  });

  it("piso econômico usa ceil e recusa denominador ≤ 0", () => {
    expect(economicFloor(4_000, 500, 2_500)).toBe(5_715);
    expect(economicFloor(7_000, 0, 0)).toBe(7_000);
    expect(economicFloor(1, 9_999, 0)).toBe(10_000);
    expect(economicFloor(null, 500, 2_500)).toBeNull();
    expect(economicFloor(100, 6_000, 4_000)).toBe("INVALID");
  });

  it("valores grandes não perdem precisão (BigInt)", () => {
    const r = computePrice({ base_cents: 9_000_000_000_001, manual_floor_cents: 0, estimated_cost_cents: null, fee_bps: null,
      target_margin_bps: 0, discount_bps: 1, max_discount_bps: 1 });
    expect(r).toMatchObject({ ok: true, final_cents: 8_999_100_000_001 });
  });

  it("final nunca abaixo do piso nem acima da base", () => {
    for (let d = 0; d <= 10_000; d += 250) {
      const r = computePrice({ base_cents: 12_345, manual_floor_cents: 7_000, estimated_cost_cents: 3_000, fee_bps: 400,
        target_margin_bps: 2_000, discount_bps: d, max_discount_bps: 10_000 });
      if (!r.ok) throw new Error("inesperado");
      expect(r.final_cents).toBeGreaterThanOrEqual(r.floor_cents);
      expect(r.final_cents).toBeLessThanOrEqual(12_345);
    }
  });
});
