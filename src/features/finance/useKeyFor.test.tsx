import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useKeyFor } from "./FinancePage.tsx";

describe("useKeyFor", () => {
  it("dois toques antes do próximo render usam a mesma chave (não duplica o recebimento)", () => {
    const { result } = renderHook(() => useKeyFor());
    const keyFor = result.current;
    const payload = { receivable_id: "r1", amount_cents: 6000, method: "pix" };
    // Sem re-render entre as chamadas: é o que acontece num toque duplo rápido.
    expect(keyFor(payload)).toBe(keyFor({ ...payload }));
  });

  it("pedido diferente ganha chave nova; voltar ao mesmo pedido depois de mudar também", () => {
    const { result, rerender } = renderHook(() => useKeyFor());
    const a = result.current({ charge: "b1" });
    rerender();
    const b = result.current({ charge: "b2" });
    expect(b).not.toBe(a);
    expect(result.current({ charge: "b2" })).toBe(b);
  });
});
