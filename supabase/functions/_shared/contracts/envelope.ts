// Envelope de resposta e catálogo de erros v1 (docs/03_CONTRATOS.md).
import { z } from "zod";
import { IsoDateTime, SCHEMA_VERSION, Uuid } from "./common.ts";

export const ResponseMeta = z.object({
  request_id: Uuid,
  as_of: IsoDateTime,
  schema_version: z.literal(SCHEMA_VERSION),
});
export type ResponseMeta = z.infer<typeof ResponseMeta>;

export function successEnvelope<T extends z.ZodType>(data: T) {
  return z.object({ data, meta: ResponseMeta });
}

/** Código → status HTTP. Lista fechada; adicionar código é mudança de contrato. */
export const ERROR_STATUS = {
  VALIDATION_ERROR: 400,
  AUTH_REQUIRED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  SLOT_CONFLICT: 409,
  STALE_VERSION: 409,
  IDEMPOTENCY_MISMATCH: 409,
  /** Link público: o mesmo contato já tem um pedido aguardando código (details traz o resumo). */
  PENDING_REQUEST_EXISTS: 409,
  POLICY_REJECTED: 422,
  QUOTA_EXCEEDED: 429,
  INTERNAL_ERROR: 500,
  PROVIDER_UNAVAILABLE: 503,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;
export const ErrorCode = z.enum(Object.keys(ERROR_STATUS) as [ErrorCode, ...ErrorCode[]]);

/** Erros em que repetir a mesma chamada (mesma Idempotency-Key) pode dar certo. */
export const RETRYABLE: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  "QUOTA_EXCEEDED",
  "INTERNAL_ERROR",
  "PROVIDER_UNAVAILABLE",
]);

export const ErrorEnvelope = z.object({
  error: z.object({
    code: ErrorCode,
    message: z.string().min(1).max(500),
    field: z.string().max(200).optional(),
    retryable: z.boolean(),
    /** Dados extras que a tela precisa para decidir (só em códigos que os documentam, como PENDING_REQUEST_EXISTS). */
    details: z.record(z.string(), z.unknown()).optional(),
  }),
  request_id: Uuid,
});
export type ErrorEnvelope = z.infer<typeof ErrorEnvelope>;

export function errorBody(
  code: ErrorCode,
  message: string,
  requestId: string,
  field?: string,
  details?: Record<string, unknown>,
): ErrorEnvelope {
  return {
    error: { code, message, retryable: RETRYABLE.has(code), ...(field ? { field } : {}), ...(details ? { details } : {}) },
    request_id: requestId,
  };
}

/** Mensagens neutras: 404/403 não revelam se o objeto privado existe. */
export const DEFAULT_MESSAGES: Record<ErrorCode, string> = {
  VALIDATION_ERROR: "Dados inválidos.",
  AUTH_REQUIRED: "Entre na sua conta para continuar.",
  FORBIDDEN: "Você não tem acesso a este recurso.",
  NOT_FOUND: "Não encontrado.",
  SLOT_CONFLICT: "Este horário não está mais disponível.",
  STALE_VERSION: "Este registro foi alterado por outra pessoa. Recarregue e tente de novo.",
  IDEMPOTENCY_MISMATCH: "Esta chave de operação já foi usada com outros dados.",
  PENDING_REQUEST_EXISTS: "Você já tem um pedido aguardando confirmação.",
  POLICY_REJECTED: "A operação não é permitida pelas regras do negócio.",
  QUOTA_EXCEEDED: "Limite de uso atingido. Tente mais tarde.",
  INTERNAL_ERROR: "Erro inesperado. Tente novamente.",
  PROVIDER_UNAVAILABLE: "Serviço externo indisponível. A operação não foi concluída.",
};
