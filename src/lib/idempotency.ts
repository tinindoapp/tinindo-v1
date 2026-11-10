// Chave de idempotência por intenção de envio (ADR-0002). O servidor grava uma vez por chave e recusa a mesma
// chave com corpo diferente. Por isso a tela, ao repetir um pedido que falhou, manda a mesma chave e o mesmo
// corpo; quando o pedido é outro, ou depois que deu certo, a chave é nova.
import { useCallback, useRef } from "react";

/**
 * Valor gerado no envio que precisa ser o mesmo na nova tentativa: a chave, ou o instante de "agora" que vai
 * no corpo. Mesmo conteúdo, mesmo valor; conteúdo diferente, valor novo; `reset()` depois do sucesso, para que
 * o próximo pedido, mesmo idêntico, seja outra operação.
 * Fica num ref, não em estado: dois toques antes do próximo render veem o mesmo valor.
 */
export function useAttemptValue<T>() {
  const current = useRef<{ content: string; value: T } | null>(null);
  const valueFor = useCallback((content: unknown, make: () => T): T => {
    const serialized = JSON.stringify(content);
    if (current.current?.content !== serialized) current.current = { content: serialized, value: make() };
    return current.current.value;
  }, []);
  const reset = useCallback(() => {
    current.current = null;
  }, []);
  return { valueFor, reset };
}

/** Chave por conteúdo: mantida no erro (repetir não duplica), trocada quando o pedido muda ou em `reset()`. */
export function useIdempotencyKey() {
  const { valueFor, reset } = useAttemptValue<string>();
  const keyFor = useCallback((payload: unknown): string => valueFor(payload, () => crypto.randomUUID()), [valueFor]);
  return { keyFor, reset };
}
