// Respostas HTTP no envelope v1. TypeScript puro (Web APIs): roda em Deno e Node 22.
import {
  DEFAULT_MESSAGES,
  ERROR_STATUS,
  errorBody,
  type ErrorCode,
  REQUEST_ID_HEADER,
  SCHEMA_VERSION,
  TENANT_HEADER,
} from "../contracts/index.ts";

export interface Clock {
  now(): Date;
}
export const systemClock: Clock = { now: () => new Date() };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isUuid = (v: string | null | undefined): v is string => !!v && UUID_RE.test(v);

/** Aceita X-Request-Id do cliente se for UUID; senão gera. Nunca ecoa texto livre. */
export function requestIdFrom(req: Request): string {
  const incoming = req.headers.get(REQUEST_ID_HEADER);
  return isUuid(incoming) ? incoming.toLowerCase() : crypto.randomUUID();
}

export function corsHeaders(req: Request, allowedOrigins: readonly string[]): Record<string, string> {
  const origin = req.headers.get("Origin");
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": `authorization, content-type, apikey, idempotency-key, ${TENANT_HEADER.toLowerCase()}, ${REQUEST_ID_HEADER.toLowerCase()}`,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    Vary: "Origin",
  };
  if (origin && allowedOrigins.includes(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

function json(status: number, body: unknown, requestId: string, extra: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      [REQUEST_ID_HEADER]: requestId,
      ...extra,
    },
  });
}

export function ok(
  data: unknown,
  requestId: string,
  clock: Clock = systemClock,
  status = 200,
  extra: Record<string, string> = {},
): Response {
  const meta = { request_id: requestId, as_of: clock.now().toISOString(), schema_version: SCHEMA_VERSION };
  return json(status, { data, meta }, requestId, extra);
}

export function fail(
  code: ErrorCode,
  requestId: string,
  opts: { message?: string; field?: string; details?: Record<string, unknown>; extra?: Record<string, string> } = {},
): Response {
  return json(
    ERROR_STATUS[code],
    errorBody(code, opts.message ?? DEFAULT_MESSAGES[code], requestId, opts.field, opts.details),
    requestId,
    opts.extra ?? {},
  );
}
