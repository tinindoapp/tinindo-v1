// Tradução de erros do banco/PostgREST para o catálogo v1.
// Convenção (migration de fundação): ERRCODE 'PTxxx' + MESSAGE = ErrorCode.
import { ERROR_STATUS, type ErrorCode } from "../contracts/index.ts";

export class AppError extends Error {
  constructor(readonly code: ErrorCode, message?: string, readonly field?: string) {
    super(message ?? code);
    this.name = "AppError";
  }
}

const isErrorCode = (v: unknown): v is ErrorCode => typeof v === "string" && v in ERROR_STATUS;

/** Erro no formato do supabase-js/PostgREST: { code, message, details, hint }. */
export interface DbErrorLike {
  code?: string | null;
  message?: string | null;
  hint?: string | null;
}

export function mapDbError(error: DbErrorLike): { code: ErrorCode; field?: string } {
  const field = error.hint && /^[a-z_.]{1,60}$/.test(error.hint) ? error.hint : undefined;
  if (isErrorCode(error.message)) return { code: error.message, field };
  switch (error.code) {
    case "PT401":
      return { code: "AUTH_REQUIRED" };
    case "PT403":
    case "42501": // permissão negada por GRANT/RLS
      return { code: "FORBIDDEN" };
    case "PT404":
      return { code: "NOT_FOUND" };
    case "23P01": // exclusion_violation: sobreposição de reserva
      return { code: "SLOT_CONFLICT" };
    case "PT400":
    case "22P02":
    case "23514":
      return { code: "VALIDATION_ERROR", field };
    default:
      return { code: "INTERNAL_ERROR" };
  }
}
