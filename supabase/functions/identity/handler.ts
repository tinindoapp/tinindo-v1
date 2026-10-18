// POST /functions/v1/identity/<operação> — comandos do P01 (ADR-0002/0003).
// Valida a entrada pelo schema, calcula o hash do corpo normalizado e chama UMA RPC transacional
// com o JWT do usuário. Autorização, idempotência e atomicidade ficam no banco.
// Lógica pura com dependências injetadas: testada em Vitest, servida por index.ts no Deno.
import type { z } from "zod";
import { IDEMPOTENCY_HEADER, IdempotencyKey, TENANT_HEADER } from "../_shared/contracts/index.ts";
import { type DbErrorLike, mapDbError } from "../_shared/http/errors.ts";
import { type Clock, corsHeaders, fail, isUuid, ok, requestIdFrom, systemClock } from "../_shared/http/respond.ts";
import { IDENTITY_OPERATIONS, type IdentityOperationName } from "./schemas.ts";

export interface IdentityDeps {
  /** Chama a RPC com o JWT do usuário (nunca com service role). */
  rpc(accessToken: string, fn: string, args: Record<string, unknown>): Promise<{ data: unknown; error: DbErrorLike | null }>;
  allowedOrigins: readonly string[];
  clock?: Clock;
  log?: (entry: Record<string, unknown>) => void;
}

/** Corpo máximo aceito. Os comandos do P01 têm poucos campos. */
export const MAX_BODY_BYTES = 8 * 1024;

/** JSON com chaves ordenadas: o mesmo payload lógico sempre gera o mesmo hash. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export async function requestHash(input: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(input));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Argumentos da RPC por operação. Entrada já validada pelo schema. */
type Input<K extends IdentityOperationName> = z.infer<(typeof IDENTITY_OPERATIONS)[K]["input"]>;
type ArgsBuilder = (input: unknown, tenantId: string | null) => Record<string, unknown>;
const RPC_ARGS: { [K in IdentityOperationName]: (i: Input<K>, tenantId: string | null) => Record<string, unknown> } = {
  "business.create": (i) => ({
    p_name: i.name,
    p_profession: i.profession,
    p_timezone: i.timezone,
    p_accepted_policy_versions: i.accepted_policy_versions,
  }),
  "onboarding.save": (i, t) => ({
    p_tenant_id: t,
    p_expected_version: i.expected_version,
    p_goal: i.goal,
    p_cancellation_notice_hours: i.cancellation_notice_hours,
    p_late_cancellation_fee_bps: i.late_cancellation_fee_bps,
    p_mark_complete: i.mark_complete,
  }),
  "customer_link.issue": (i, t) => ({ p_tenant_id: t, p_customer_id: i.customer_id }),
  "customer_link.redeem": (i) => ({ p_code: i.code }),
  "customer_link.revoke": (i, t) => ({
    p_tenant_id: t,
    p_link_id: i.link_id,
    p_expected_version: i.expected_version,
  }),
};

/** Argumentos completos da RPC (sem chave e hash). Exportado para o teste de assinatura SQL. */
export function rpcArgs(op: IdentityOperationName, input: unknown, tenantId: string | null): Record<string, unknown> {
  return (RPC_ARGS[op] as ArgsBuilder)(input, tenantId);
}

const isOperation = (v: string): v is IdentityOperationName => Object.hasOwn(IDENTITY_OPERATIONS, v);

function operationFrom(req: Request): string | null {
  const match = /\/identity\/([a-z_]+\.[a-z_]+)\/?$/.exec(new URL(req.url).pathname);
  return match?.[1] ?? null;
}

export function createIdentityHandler(deps: IdentityDeps) {
  const clock = deps.clock ?? systemClock;
  return async (req: Request): Promise<Response> => {
    const started = clock.now().getTime();
    const requestId = requestIdFrom(req);
    const cors = corsHeaders(req, deps.allowedOrigins);
    const op = operationFrom(req);
    const res = await handle(req, op, requestId, cors);
    // Log técnico sem PII: sem tenant, sem token, sem corpo, sem código de vínculo.
    deps.log?.({
      fn: "identity",
      op: op && isOperation(op) ? op : null,
      request_id: requestId,
      status: res.status,
      ms: clock.now().getTime() - started,
    });
    return res;
  };

  async function handle(req: Request, op: string | null, requestId: string, cors: Record<string, string>): Promise<Response> {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (!op || !isOperation(op)) return fail("NOT_FOUND", requestId, { extra: cors });
    if (req.method !== "POST") return fail("VALIDATION_ERROR", requestId, { message: "Use POST.", extra: cors });
    const spec = IDENTITY_OPERATIONS[op];

    const auth = req.headers.get("Authorization") ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    if (!token) return fail("AUTH_REQUIRED", requestId, { extra: cors });

    const key = IdempotencyKey.safeParse(req.headers.get(IDEMPOTENCY_HEADER) ?? "");
    if (!key.success) {
      return fail("VALIDATION_ERROR", requestId, {
        field: "idempotency_key", message: "Envie o header Idempotency-Key.", extra: cors,
      });
    }

    let tenantId: string | null = null;
    if (spec.tenantScoped) {
      tenantId = req.headers.get(TENANT_HEADER);
      if (!isUuid(tenantId)) {
        return fail("VALIDATION_ERROR", requestId, { field: "tenant_id", message: "Selecione um negócio.", extra: cors });
      }
    }

    const raw = await req.text();
    if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) {
      return fail("VALIDATION_ERROR", requestId, { message: "Corpo grande demais.", extra: cors });
    }
    let body: unknown;
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      return fail("VALIDATION_ERROR", requestId, { message: "JSON inválido.", extra: cors });
    }
    const parsed = spec.input.safeParse(body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return fail("VALIDATION_ERROR", requestId, { field: issue?.path.join(".") || undefined, extra: cors });
    }

    const args = {
      ...rpcArgs(op, parsed.data, tenantId),
      p_idem_key: key.data,
      p_request_hash: await requestHash(parsed.data),
    };

    let result: Awaited<ReturnType<IdentityDeps["rpc"]>>;
    try {
      result = await deps.rpc(token, spec.rpc, args);
    } catch {
      return fail("PROVIDER_UNAVAILABLE", requestId, { extra: cors });
    }
    if (result.error) {
      const mapped = mapDbError(result.error);
      return fail(mapped.code, requestId, { field: mapped.field, extra: cors });
    }

    const envelope = result.data as { status_code?: unknown; body?: unknown } | null;
    const status = typeof envelope?.status_code === "number" ? envelope.status_code : NaN;
    const out = spec.output.safeParse(envelope?.body);
    if (!(status >= 200 && status < 300) || !out.success) return fail("INTERNAL_ERROR", requestId, { extra: cors });
    return ok(out.data, requestId, clock, status, cors);
  }
}
