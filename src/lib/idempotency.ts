// Chave de idempotência por intenção de envio (ADR-0002). O servidor grava uma vez por chave e recusa a mesma
// chave com corpo diferente. Por isso a tela, ao repetir um pedido que falhou, manda a mesma chave e o mesmo
// corpo; quando o pedido é outro, ou depois que deu certo, a chave é nova.
//
// Este é o único lugar do app que gera chave. Módulo não chama `crypto.randomUUID()` nem declara `newKey`
// (regra de lint em eslint.config.js). Três formas de uso, da mais simples para a mais flexível:
//   - `useCommand()`: comando de um toque (cancelar, estornar, marcar). Cuida da chave e do reset sozinho.
//   - `useIdempotencyKey()`: formulário que monta o corpo, valida e envia; a tela chama `reset()` no sucesso.
//   - `newIdempotencyKey()`: chave fixa por tela aberta (link público: aceitar e recusar valem uma vez).
// Regra do corpo: nada de relógio dentro do pedido idempotente. Se o pedido leva "agora", o instante sai de
// `useAttemptValue`, para ser o mesmo na nova tentativa.
import { useCallback, useRef } from "react";

/** Chave nova. Só use direto quando a chave vale pela tela aberta; no resto, `useCommand` ou `useIdempotencyKey`. */
export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

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
  const keyFor = useCallback((payload: unknown): string => valueFor(payload, newIdempotencyKey), [valueFor]);
  return { keyFor, reset };
}

/**
 * Comando idempotente de um toque. `run(intenção, enviar)` chama `enviar(chave)`:
 *   - deu certo: a chave é descartada, e repetir a mesma ação depois é outra operação;
 *   - falhou: a chave fica, e tocar de novo na mesma ação repete o mesmo pedido (o servidor não duplica);
 *   - a intenção mudou (outra linha, outra versão, outro valor): chave nova.
 * A intenção é o que identifica o pedido para a pessoa: nome da ação, id e versão do registro, valores enviados.
 * Não ponha relógio nela. Um `useCommand()` por componente basta: ele guarda a última intenção.
 */
export function useCommand() {
  const { keyFor, reset } = useIdempotencyKey();
  return useCallback(
    async <T>(intent: unknown, send: (key: string) => Promise<T>): Promise<T> => {
      const out = await send(keyFor(intent));
      reset();
      return out;
    },
    [keyFor, reset],
  );
}
