// GET /functions/v1/context — caminho de referência request → autorização → banco.
// O header X-Tinindo-Tenant é seleção; quem decide é public.resolve_context (RLS/membership).
// Lógica pura com dependências injetadas: testada em Vitest, servida por index.ts no Deno.
import { ContextResponse, TENANT_HEADER } from "../_shared/contracts/index.ts";
import { type DbErrorLike, mapDbError } from "../_shared/http/errors.ts";
import { type Clock, corsHeaders, fail, isUuid, ok, requestIdFrom, systemClock } from "../_shared/http/respond.ts";

export interface ContextDeps {
  /** Chama resolve_context com o JWT do usuário (nunca com service role). */
  resolveContext(
    accessToken: string,
    tenantId: string,
  ): Promise<{ data: unknown[] | null; error: DbErrorLike | null }>;
  allowedOrigins: readonly string[];
  clock?: Clock;
  log?: (entry: Record<string, unknown>) => void;
}

export function createContextHandler(deps: ContextDeps) {
  const clock = deps.clock ?? systemClock;
  return async (req: Request): Promise<Response> => {
    const started = clock.now().getTime();
    const requestId = requestIdFrom(req);
    const cors = corsHeaders(req, deps.allowedOrigins);
    const res = await handle(req, requestId, cors);
    // Log técnico sem PII: sem tenant, sem token, sem corpo.
    deps.log?.({ fn: "context", request_id: requestId, status: res.status, ms: clock.now().getTime() - started });
    return res;
  };

  async function handle(req: Request, requestId: string, cors: Record<string, string>): Promise<Response> {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (req.method !== "GET") {
      return fail("VALIDATION_ERROR", requestId, { message: "Use GET.", extra: cors });
    }

    const auth = req.headers.get("Authorization") ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    if (!token) return fail("AUTH_REQUIRED", requestId, { extra: cors });

    const tenantId = req.headers.get(TENANT_HEADER);
    if (!isUuid(tenantId)) {
      return fail("VALIDATION_ERROR", requestId, { field: "tenant_id", message: "Selecione um negócio.", extra: cors });
    }

    let result: Awaited<ReturnType<ContextDeps["resolveContext"]>>;
    try {
      result = await deps.resolveContext(token, tenantId);
    } catch {
      return fail("PROVIDER_UNAVAILABLE", requestId, { extra: cors });
    }
    if (result.error) {
      const mapped = mapDbError(result.error);
      return fail(mapped.code, requestId, { field: mapped.field, extra: cors });
    }
    const row = result.data?.[0];
    if (!row) return fail("FORBIDDEN", requestId, { extra: cors });

    const parsed = ContextResponse.safeParse(row);
    if (!parsed.success) return fail("INTERNAL_ERROR", requestId, { extra: cors });
    return ok(parsed.data, requestId, clock, 200, cors);
  }
}
