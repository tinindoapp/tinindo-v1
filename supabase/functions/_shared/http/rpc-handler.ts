// Edge Functions do tipo "rota → uma RPC": POST /functions/v1/<módulo>/<operação> → valida no contrato →
// chama UMA RPC com o JWT do usuário → o banco autoriza, aplica idempotência/versão e audita na mesma
// transação. O header X-Tinindo-Tenant é seleção; não concede acesso. Log técnico sem PII.
import type { z } from "zod";
import { IDEMPOTENCY_HEADER, IdempotencyKey, TENANT_HEADER } from "../contracts/index.ts";
import { canonicalJson, sha256Hex } from "./command.ts";
import { type DbErrorLike, mapDbError } from "./errors.ts";
import { type Clock, corsHeaders, fail, isUuid, ok, requestIdFrom, systemClock } from "./respond.ts";

export type RpcResult = { data: unknown; error: DbErrorLike | null };

export interface RpcHandlerDeps {
  /** Chama a RPC com o JWT do usuário (nunca com service role). */
  rpc(accessToken: string, fn: string, args: Record<string, unknown>): Promise<RpcResult>;
  allowedOrigins: readonly string[];
  clock?: Clock;
  log?: (entry: Record<string, unknown>) => void;
}

export type Args = Record<string, unknown>;

export interface Route {
  rpc: string;
  input: z.ZodType;
  output: z.ZodType;
  /** Comando: exige Idempotency-Key e devolve {status_code, body} do banco. */
  command: boolean;
  args(input: never): Args | false;
  /** Ajusta a resposta da RPC ao contrato (ex.: cursor opaco). */
  shape?(data: unknown): unknown;
}

export const route = <I extends z.ZodType>(r: {
  rpc: string;
  input: I;
  output: z.ZodType;
  command: boolean;
  args(input: z.output<I>): Args | false;
  shape?(data: unknown): unknown;
}): Route => r as unknown as Route;

const MAX_BODY_BYTES = 64 * 1024;

export function createRpcHandler(module: string, routes: Record<string, Route>, deps: RpcHandlerDeps) {
  const routeRe = new RegExp(`/${module}/([a-z_.]+)/?$`);
  const clock = deps.clock ?? systemClock;

  return async (req: Request): Promise<Response> => {
    const started = clock.now().getTime();
    const requestId = requestIdFrom(req);
    const cors = corsHeaders(req, deps.allowedOrigins);
    const name = routeRe.exec(new URL(req.url).pathname)?.[1] ?? "";
    const res = await handle(req, name, requestId, cors);
    // Log técnico sem PII: sem tenant, token ou corpo.
    deps.log?.({ fn: module, route: name, request_id: requestId, status: res.status, ms: clock.now().getTime() - started });
    return res;
  };

  async function handle(req: Request, name: string, requestId: string, cors: Record<string, string>) {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    const spec = Object.hasOwn(routes, name) ? routes[name] : undefined;
    if (!spec) return fail("NOT_FOUND", requestId, { extra: cors });
    if (req.method !== "POST") return fail("VALIDATION_ERROR", requestId, { message: "Use POST.", extra: cors });

    const auth = req.headers.get("Authorization") ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    if (!token) return fail("AUTH_REQUIRED", requestId, { extra: cors });
    const tenantId = req.headers.get(TENANT_HEADER);
    if (!isUuid(tenantId)) {
      return fail("VALIDATION_ERROR", requestId, { field: "tenant_id", message: "Selecione um negócio.", extra: cors });
    }

    let key: string | null = null;
    if (spec.command) {
      const parsedKey = IdempotencyKey.safeParse(req.headers.get(IDEMPOTENCY_HEADER));
      if (!parsedKey.success) {
        return fail("VALIDATION_ERROR", requestId, {
          field: "idempotency_key", message: "Envie o header Idempotency-Key.", extra: cors,
        });
      }
      key = parsedKey.data;
    }

    const text = await req.text().catch(() => "");
    if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
      return fail("VALIDATION_ERROR", requestId, { message: "Corpo grande demais.", extra: cors });
    }
    let json: unknown;
    try {
      json = text.trim() === "" ? {} : JSON.parse(text);
    } catch {
      return fail("VALIDATION_ERROR", requestId, { message: "JSON inválido.", extra: cors });
    }
    const input = spec.input.safeParse(json);
    if (!input.success) {
      const path = input.error.issues[0]?.path.map(String).join(".");
      return fail("VALIDATION_ERROR", requestId, { field: path || undefined, extra: cors });
    }
    const args = spec.args(input.data as never);
    if (args === false) return fail("VALIDATION_ERROR", requestId, { field: "cursor", extra: cors });

    const rpcArgs: Args = { p_tenant_id: tenantId, ...args };
    if (spec.command) {
      Object.assign(rpcArgs, {
        p_idem_key: key,
        // O hash cobre a operação e a entrada normalizada (com defaults), nunca a chave.
        p_request_hash: await sha256Hex(canonicalJson({ operation: name, input: input.data })),
        p_request_id: requestId,
      });
    }

    let result: RpcResult;
    try {
      result = await deps.rpc(token, spec.rpc, rpcArgs);
    } catch {
      return fail("PROVIDER_UNAVAILABLE", requestId, { extra: cors });
    }
    if (result.error) {
      const mapped = mapDbError(result.error);
      return fail(mapped.code, requestId, { field: mapped.field, extra: cors });
    }

    let status = 200;
    let body: unknown = result.data;
    if (spec.command) {
      const envelope = result.data as { status_code?: unknown; body?: unknown } | null;
      status = typeof envelope?.status_code === "number" ? envelope.status_code : 0;
      if (status < 200 || status > 299) return fail("INTERNAL_ERROR", requestId, { extra: cors });
      body = envelope?.body;
    }
    if (spec.shape) body = spec.shape(body);
    const parsed = spec.output.safeParse(body);
    if (!parsed.success) return fail("INTERNAL_ERROR", requestId, { extra: cors });
    return ok(parsed.data, requestId, clock, status, cors);
  }
}
