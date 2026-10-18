// Edge Function `jobs` (P06): uma rodada do worker (expira holds/ofertas e despacha o outbox).
// Chamada pelo agendador do ambiente (Supabase Cron → HTTP) com o segredo JOBS_SECRET no header.
// É a ÚNICA função que usa a chave de serviço, e só para chamar public.jobs_run (que já é seguro em paralelo).
import { type Clock, fail, ok, requestIdFrom, systemClock } from "../_shared/http/respond.ts";

export const JOBS_SECRET_HEADER = "X-Tinindo-Jobs-Secret";

export interface JobsDeps {
  secret: string;
  /** Chama public.jobs_run com a chave de serviço (somente no backend). */
  runJobs(batch: number): Promise<{ data: unknown; error: { message?: string | null } | null }>;
  clock?: Clock;
  log?: (entry: Record<string, unknown>) => void;
}

/** Comparação em tempo constante para o segredo. */
function sameSecret(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export function createJobsHandler(deps: JobsDeps) {
  const clock = deps.clock ?? systemClock;
  if (deps.secret.length < 32) throw new Error("JOBS_SECRET precisa de pelo menos 32 caracteres");
  return async (req: Request): Promise<Response> => {
    const requestId = requestIdFrom(req);
    if (req.method !== "POST") return fail("VALIDATION_ERROR", requestId, { message: "Use POST." });
    if (!sameSecret(req.headers.get(JOBS_SECRET_HEADER) ?? "", deps.secret)) return fail("AUTH_REQUIRED", requestId);
    const result = await deps.runJobs(100).catch(() => ({ data: null, error: { message: "rede" } }));
    if (result.error) {
      deps.log?.({ fn: "jobs", request_id: requestId, status: 503 });
      return fail("PROVIDER_UNAVAILABLE", requestId);
    }
    deps.log?.({ fn: "jobs", request_id: requestId, status: 200, result: result.data });
    return ok(result.data, requestId, clock);
  };
}
