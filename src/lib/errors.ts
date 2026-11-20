// Erros da API para a pessoa: um leitor do erro e um tradutor por código, para o app inteiro.
// O servidor responde com código e, às vezes, o campo (ADR-0002). Cada módulo só declara as frases do seu
// domínio; a leitura do erro, a ordem de procura e as frases comuns ficam aqui.
import { ApiError } from "./api/client.ts";

export interface ErrorInfo {
  code?: string;
  field?: string;
}

/** Código e campo de qualquer coisa que foi lançada (ApiError, objeto solto das portas de demonstração, ou nada). */
export function errorInfo(err: unknown): ErrorInfo {
  if (typeof err !== "object" || err === null) return {};
  const e = err as { code?: unknown; field?: unknown };
  return {
    code: typeof e.code === "string" ? e.code : undefined,
    field: typeof e.field === "string" ? e.field : undefined,
  };
}

/** Frase padrão quando o módulo não tem uma específica: o pedido leva chave, repetir não duplica. */
export const SAFE_RETRY = "Não foi possível concluir agora. Tentar de novo é seguro.";

type Phrase = string | ((e: ErrorInfo, err: unknown) => string);

/**
 * Frases de um módulo. Chave "CODIGO.campo" (mais específica) ou "CODIGO"; `default` troca a frase padrão.
 * Exemplo: { "POLICY_REJECTED.stock": "Estoque insuficiente…", POLICY_REJECTED: "As regras não permitem…" }.
 */
export type ErrorPhrases = Record<string, Phrase> & { default?: Phrase };

/** Procura "CODIGO.campo", depois "CODIGO", depois `default`, depois a frase padrão. */
export function explainError(err: unknown, phrases: ErrorPhrases = {}): string {
  const e = errorInfo(err);
  const own = (key: string | undefined) => (key !== undefined && Object.hasOwn(phrases, key) ? phrases[key] : undefined);
  const found = own(e.code && e.field ? `${e.code}.${e.field}` : undefined) ?? own(e.code) ?? own("default") ?? SAFE_RETRY;
  return typeof found === "function" ? found(e, err) : found;
}

/** Tradutor pronto para um módulo: `export const explain = errorExplainer({ … })`. */
export function errorExplainer(phrases: ErrorPhrases): (err: unknown) => string {
  return (err) => explainError(err, phrases);
}

/** Texto que o servidor mandou (já neutro e em português); para erro que não veio da API, a frase genérica. */
export function serverMessage(err: unknown, fallback = "Erro inesperado. Tente novamente."): string {
  return err instanceof ApiError ? err.message : fallback;
}

/** O pedido pode ter chegado ao servidor ou não (sem conexão, 5xx): é quando vale repetir com a mesma chave. */
export function isRetryable(err: unknown): boolean {
  return err instanceof ApiError ? err.retryable : false;
}
