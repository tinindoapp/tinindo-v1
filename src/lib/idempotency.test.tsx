import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useAttemptValue, useIdempotencyKey } from "./idempotency.ts";

describe("useIdempotencyKey", () => {
  it("dois toques antes do próximo render usam a mesma chave (não duplica o recebimento)", () => {
    const { result } = renderHook(() => useIdempotencyKey());
    const payload = { receivable_id: "r1", amount_cents: 6000, method: "pix" };
    // Sem re-render entre as chamadas: é o que acontece num toque duplo rápido.
    expect(result.current.keyFor(payload)).toBe(result.current.keyFor({ ...payload }));
  });

  it("pedido diferente ganha chave nova; o mesmo pedido, depois de um render, mantém a chave", () => {
    const { result, rerender } = renderHook(() => useIdempotencyKey());
    const a = result.current.keyFor({ charge: "b1" });
    rerender();
    const b = result.current.keyFor({ charge: "b2" });
    expect(b).not.toBe(a);
    rerender();
    expect(result.current.keyFor({ charge: "b2" })).toBe(b);
  });

  it("depois do sucesso (reset), o mesmo pedido é outra operação e ganha chave nova", () => {
    const { result } = renderHook(() => useIdempotencyKey());
    const first = result.current.keyFor({ block: "sexta à tarde" });
    result.current.reset();
    expect(result.current.keyFor({ block: "sexta à tarde" })).not.toBe(first);
  });
});

describe("useAttemptValue", () => {
  it("o instante gerado no envio é o mesmo na nova tentativa e muda quando o pedido muda", () => {
    const { result } = renderHook(() => useAttemptValue<string>());
    let clock = 0;
    const now = () => `2026-10-20T12:00:0${(clock += 1)}.000Z`;
    const first = result.current.valueFor({ receivable_id: "r1", cents: 3000 }, now);
    // Nova tentativa do mesmo pedido: o relógio andou, o valor enviado não.
    expect(result.current.valueFor({ receivable_id: "r1", cents: 3000 }, now)).toBe(first);
    expect(result.current.valueFor({ receivable_id: "r1", cents: 4000 }, now)).not.toBe(first);
    result.current.reset();
    expect(result.current.valueFor({ receivable_id: "r1", cents: 4000 }, now)).toBe("2026-10-20T12:00:03.000Z");
  });
});
