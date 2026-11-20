import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { newIdempotencyKey, useAttemptValue, useCommand, useIdempotencyKey } from "./idempotency.ts";

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

describe("useCommand", () => {
  it("deu certo: devolve o resultado e a mesma ação, depois, é outra operação (chave nova)", async () => {
    const { result } = renderHook(() => useCommand());
    const keys: string[] = [];
    const send = async (key: string) => { keys.push(key); return "ok"; };
    expect(await result.current({ cancel: "b1", version: 1 }, send)).toBe("ok");
    await result.current({ cancel: "b1", version: 1 }, send);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it("falhou: tocar de novo na mesma ação repete o pedido com a mesma chave; depois do sucesso, chave nova", async () => {
    const { result, rerender } = renderHook(() => useCommand());
    const keys: string[] = [];
    let online = false;
    const send = async (key: string) => { keys.push(key); if (!online) throw new Error("sem conexão"); return key; };
    const intent = { reverse: "p1" };
    await expect(result.current(intent, send)).rejects.toThrow("sem conexão");
    rerender();
    await expect(result.current({ ...intent }, send)).rejects.toThrow("sem conexão");
    online = true;
    await result.current(intent, send);
    await result.current(intent, send);
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).toBe(keys[0]);
    expect(keys[3]).not.toBe(keys[0]);
  });

  it("intenção diferente depois de uma falha ganha chave nova", async () => {
    const { result } = renderHook(() => useCommand());
    const keys: string[] = [];
    const fail = async (key: string) => { keys.push(key); throw new Error("x"); };
    await expect(result.current({ cancel: "b1", version: 1 }, fail)).rejects.toThrow();
    await expect(result.current({ cancel: "b1", version: 2 }, fail)).rejects.toThrow();
    expect(keys[0]).not.toBe(keys[1]);
  });

  it("dois toques antes da resposta mandam a mesma chave", async () => {
    const { result } = renderHook(() => useCommand());
    const keys: string[] = [];
    let release = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    const send = async (key: string) => { keys.push(key); await gate; };
    const a = result.current({ mark: "s1" }, send);
    const b = result.current({ mark: "s1" }, send);
    release();
    await Promise.all([a, b]);
    expect(keys[0]).toBe(keys[1]);
  });
});

describe("newIdempotencyKey", () => {
  it("gera UUIDs diferentes", () => {
    const a = newIdempotencyKey();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(newIdempotencyKey()).not.toBe(a);
  });
});
