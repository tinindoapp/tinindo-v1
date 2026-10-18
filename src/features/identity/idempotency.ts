// Chave de idempotência por intenção de envio: o mesmo payload reusa a chave (retry seguro após
// falha de rede); payload diferente ou envio concluído geram chave nova.
import { useCallback, useRef } from "react";

export function useIdempotencyKey() {
  const current = useRef<{ payload: string; key: string } | null>(null);
  const keyFor = useCallback((payload: unknown): string => {
    const serialized = JSON.stringify(payload);
    if (current.current?.payload !== serialized) {
      current.current = { payload: serialized, key: crypto.randomUUID() };
    }
    return current.current.key;
  }, []);
  const reset = useCallback(() => {
    current.current = null;
  }, []);
  return { keyFor, reset };
}
