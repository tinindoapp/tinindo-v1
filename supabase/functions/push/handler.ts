// Edge Function `push` (P34, avisos no celular).
// - Rotas do aparelho (JWT da pessoa, chave pública): push.config, push.subscribe, push.prefs, push.unsubscribe,
//   push.device e push.test. Cada uma chama UMA RPC, e o banco confere membro, dono da assinatura e negócio.
// - push.dispatch: chamada pelo agendador com o segredo dos jobs (X-Tinindo-Jobs-Secret). Pega a fila com a chave de
//   serviço (push_claim), cifra e envia cada aviso (webpush.ts) e anota o resultado (push_report).
// Sem chaves VAPID no ambiente, o push fica desligado: config diz available false, assinar é recusado e dispatch não
// envia nada. Log técnico sem endpoint, chave nem conteúdo.
import { createRpcHandler, route, type RpcHandlerDeps } from "../_shared/http/rpc-handler.ts";
import { type Clock, corsHeaders, fail, ok, requestIdFrom, systemClock } from "../_shared/http/respond.ts";
import {
  PUSH_ROUTES, PushConfigOutput, PushDeviceOutput, PushEndpointInput, PushPrefsInput, PushSubscribeInput, PushTestOutput,
  PushUnsubscribeOutput, pushEndpointAllowed,
} from "./schemas.ts";
import { sendPush, type VapidKeys } from "./webpush.ts";
import { z } from "zod";

export const JOBS_SECRET_HEADER = "X-Tinindo-Jobs-Secret";

export interface PushDeps extends RpcHandlerDeps {
  vapid: VapidKeys | null;
  /** Segredo dos jobs (o mesmo do `jobs`); ausente = push.dispatch recusa. */
  jobsSecret: string | null;
  /** RPCs da fila com a chave de serviço (só backend). */
  serviceRpc(fn: "push_claim" | "push_report", args: Record<string, unknown>): Promise<{ data: unknown; error: { message?: string | null } | null }>;
  fetch?: typeof fetch;
  clock?: Clock;
}

const Claimed = z.array(z.object({
  id: z.uuid(), kind: z.string(), title: z.string(), body: z.string(), url: z.string(), attempts: z.number(),
  endpoint: z.string(), p256dh: z.string(), auth: z.string(),
}));

function sameSecret(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/** Validade do aviso no serviço de push: o lembrete de 30 min não serve depois de meia hora. */
const ttlFor = (kind: string) => (kind === "reminder_30" ? 1800 : kind === "daily_summary" ? 4 * 3600 : 86_400);

export function createPushHandler(deps: PushDeps) {
  const clock = deps.clock ?? systemClock;
  const available = !!deps.vapid;
  const off = () => false as const;
  const rpcRoutes = createRpcHandler("push", {
    [PUSH_ROUTES.subscribe]: route({
      rpc: "push_subscribe", input: PushSubscribeInput, output: PushDeviceOutput, command: false,
      args: (i) => (available
        ? { p_endpoint: i.endpoint, p_p256dh: i.keys.p256dh, p_auth: i.keys.auth, p_label: i.device_label, p_prefs: i.prefs }
        : off()),
    }),
    [PUSH_ROUTES.prefs]: route({
      rpc: "push_prefs_save", input: PushPrefsInput, output: PushDeviceOutput, command: false,
      args: (i) => ({ p_endpoint: i.endpoint, p_prefs: i.prefs }),
    }),
    [PUSH_ROUTES.unsubscribe]: route({
      rpc: "push_unsubscribe", input: PushEndpointInput, output: PushUnsubscribeOutput, command: false,
      args: (i) => ({ p_endpoint: i.endpoint }),
    }),
    [PUSH_ROUTES.device]: route({
      rpc: "push_device", input: PushEndpointInput, output: PushDeviceOutput, command: false,
      args: (i) => ({ p_endpoint: i.endpoint }),
    }),
    [PUSH_ROUTES.test]: route({
      rpc: "push_test", input: PushEndpointInput, output: PushTestOutput, command: false,
      args: (i) => (available ? { p_endpoint: i.endpoint } : off()),
    }),
  }, deps);

  async function dispatch(req: Request, requestId: string): Promise<Response> {
    if (req.method !== "POST") return fail("VALIDATION_ERROR", requestId, { message: "Use POST." });
    if (!deps.jobsSecret || deps.jobsSecret.length < 32 || !sameSecret(req.headers.get(JOBS_SECRET_HEADER) ?? "", deps.jobsSecret)) {
      return fail("AUTH_REQUIRED", requestId);
    }
    if (!deps.vapid) return ok({ sent: 0, gone: 0, failed: 0, disabled: true }, requestId, clock);
    const claimed = await deps.serviceRpc("push_claim", { p_batch: 50 }).catch(() => ({ data: null, error: { message: "rede" } }));
    if (claimed.error) return fail("PROVIDER_UNAVAILABLE", requestId);
    const items = Claimed.safeParse(claimed.data ?? []);
    if (!items.success) return fail("INTERNAL_ERROR", requestId);
    const counts = { sent: 0, gone: 0, failed: 0, disabled: false };
    for (const it of items.data) {
      const outcome = pushEndpointAllowed(it.endpoint)
        ? await sendPush({ endpoint: it.endpoint, p256dh: it.p256dh, auth: it.auth }, { title: it.title, body: it.body, url: it.url, kind: it.kind },
          deps.vapid, { fetch: deps.fetch ?? fetch, nowSeconds: Math.floor(clock.now().getTime() / 1000), ttlSeconds: ttlFor(it.kind) })
        : { result: "gone" as const, http: null };
      counts[outcome.result] += 1;
      await deps.serviceRpc("push_report", { p_id: it.id, p_result: outcome.result, p_http: outcome.http }).catch(() => undefined);
    }
    deps.log?.({ fn: "push", route: PUSH_ROUTES.dispatch, request_id: requestId, ...counts });
    return ok(counts, requestId, clock);
  }

  return async (req: Request): Promise<Response> => {
    const requestId = requestIdFrom(req);
    const name = /\/push\/([a-z_.]+)\/?$/.exec(new URL(req.url).pathname)?.[1] ?? "";
    if (name === PUSH_ROUTES.dispatch) return dispatch(req, requestId);
    if (name === PUSH_ROUTES.config) {
      const cors = corsHeaders(req, deps.allowedOrigins);
      if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
      const body = PushConfigOutput.parse({ available, public_key: deps.vapid?.publicKey ?? null });
      return ok(body, requestId, clock, 200, cors);
    }
    const res = await rpcRoutes(req);
    // Sem VAPID, assinar e testar chegam aqui com args false (o rpc-handler devolve 400 em "cursor"): explica melhor.
    if (!available && res.status === 400 && (name === PUSH_ROUTES.subscribe || name === PUSH_ROUTES.test)) {
      return fail("PROVIDER_UNAVAILABLE", requestId, { message: "Os avisos no celular não estão ligados neste ambiente.", extra: corsHeaders(req, deps.allowedOrigins) });
    }
    return res;
  };
}
