// Cliente tipado das Edge Functions. Valida o envelope v1 na volta (JSON externo não é confiável),
// propaga tenant selecionado, request id e Idempotency-Key.
import {
  ErrorEnvelope,
  type ErrorCode,
  IDEMPOTENCY_HEADER,
  REQUEST_ID_HEADER,
  ResponseMeta,
  successEnvelope,
  TENANT_HEADER,
} from "@contracts";
import type { z } from "zod";

export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly status: number,
    readonly requestId: string | null,
    readonly retryable: boolean,
    readonly field?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  publishableKey: string;
  getAccessToken: () => Promise<string | null>;
  fetch?: typeof fetch;
}

export interface CallOptions {
  method?: "GET" | "POST";
  tenantId?: string;
  body?: unknown;
  /** Obrigatório para comandos críticos; reutilizar a mesma chave em retry. */
  idempotencyKey?: string;
}

export function createApiClient(opts: ApiClientOptions) {
  const doFetch = opts.fetch ?? fetch;

  return async function call<T extends z.ZodType>(
    path: string,
    schema: T,
    { method = "GET", tenantId, body, idempotencyKey }: CallOptions = {},
  ): Promise<{ data: z.infer<T>; meta: z.infer<typeof ResponseMeta> }> {
    const requestId = crypto.randomUUID();
    const headers: Record<string, string> = {
      apikey: opts.publishableKey,
      [REQUEST_ID_HEADER]: requestId,
    };
    const token = await opts.getAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    if (tenantId) headers[TENANT_HEADER] = tenantId;
    if (idempotencyKey) headers[IDEMPOTENCY_HEADER] = idempotencyKey;
    if (body !== undefined) headers["Content-Type"] = "application/json";

    let res: Response;
    try {
      res = await doFetch(`${opts.baseUrl.replace(/\/$/, "")}/functions/v1${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new ApiError("PROVIDER_UNAVAILABLE", "Sem conexão com o servidor.", 0, requestId, true);
    }

    const json: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const err = ErrorEnvelope.safeParse(json);
      if (err.success) {
        const e = err.data.error;
        throw new ApiError(e.code, e.message, res.status, err.data.request_id, e.retryable, e.field);
      }
      throw new ApiError("INTERNAL_ERROR", "Resposta inesperada do servidor.", res.status, requestId, true);
    }
    const parsed = successEnvelope(schema).safeParse(json);
    if (!parsed.success) {
      throw new ApiError("INTERNAL_ERROR", "Resposta fora do contrato.", res.status, requestId, false);
    }
    return parsed.data as { data: z.infer<T>; meta: z.infer<typeof ResponseMeta> };
  };
}
