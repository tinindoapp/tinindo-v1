// Edge Function `payments` (P14): pagamento conectado por PSP atrás de porta.
// Rotas do dono (JWT): listar cobranças e conciliações pelo rpc-handler; criar cobrança, cancelar, estornar e
// conciliar passam pelo rpc-handler (autorização, idempotência, hash) e depois falam com o provedor; o resultado
// do provedor entra pelo backend (chave de serviço), nunca pelo JWT do dono.
// Rotas públicas (anônimas, token no corpo): payment.link_view; payment.sim_pay (só cobrança simulada: o "cliente"
// paga e o PSP fictício notifica pelo MESMO webhook assinado).
// Rotas de sistema: payment.webhook/<provider> (assinatura sobre o corpo bruto → ingestão deduplicada);
// payment.sync (segredo → consulta de cobranças desconhecidas ou vencidas; nunca presume pago).
// Log técnico sem token, Pix, valores ou tenant.
import type { z } from "zod";
import {
  ChargeCancelInput,
  ChargeCreateInput,
  ChargeOutput,
  ChargesListInput,
  ChargesListOutput,
  IDEMPOTENCY_HEADER,
  IdempotencyKey,
  type PaymentCharge,
  PaymentLinkInput,
  PaymentLinkView,
  PaymentProvider,
  type PaymentRefund,
  ReconcileInput,
  ReconcileOutput,
  ReconciliationsListInput,
  ReconciliationsListOutput,
  RefundOutput,
  RefundRequestInput,
  SimPayInput,
  SimPayOutput,
  SyncOutput,
  TENANT_HEADER,
} from "../_shared/contracts/index.ts";
import { hmacSha256Hex, sameHex } from "../_shared/domain/messaging/providers.ts";
import { type PaymentEvent, type PaymentProviderPort, signSimulatedBody } from "../_shared/domain/payments/providers.ts";
import { canonicalJson, sha256Hex } from "../_shared/http/command.ts";
import { mapDbError } from "../_shared/http/errors.ts";
import { corsHeaders, fail, isUuid, ok, requestIdFrom, systemClock } from "../_shared/http/respond.ts";
import { createRpcHandler, type Route, route, type RpcHandlerDeps, type RpcResult } from "../_shared/http/rpc-handler.ts";
import { z as zod } from "zod";

export const SYNC_SECRET_HEADER = "X-Tinindo-Sync-Secret";
export const SIGNATURE_HEADER = "X-Hub-Signature-256";
const MAX_WEBHOOK_BYTES = 256 * 1024;
const CHARGE_TTL_MIN = 60;

export interface PaymentsDeps extends RpcHandlerDeps {
  /** RPCs de sistema (resultado do provedor, ingestão, sync, PSP simulado) com a chave de serviço. */
  serviceRpc(fn: string, args: Record<string, unknown>): Promise<RpcResult>;
  /** RPCs anônimas do link (payment_link_view). */
  anonRpc(fn: string, args: Record<string, unknown>): Promise<RpcResult>;
  providers: Partial<Record<z.infer<typeof PaymentProvider>, PaymentProviderPort>>;
  syncSecret: string;
  simulatedSecret: string;
  publicAppUrl: string;
}

/** Corpo bruto da RPC de criação: cobrança + token do link (vira pay_url na função; o token nunca é logado). */
const ChargeCreateRpcBody = zod.object({ charge: ChargeOutput.shape.charge, link_token: zod.string() });

export const PAYMENTS_ROUTES: Record<string, Route> = {
  "payment.charges": route({ rpc: "payment_charges_list", input: ChargesListInput, output: ChargesListOutput, command: false, args: () => ({}) }),
  "payment.reconciliations": route({ rpc: "payment_reconciliations_list", input: ReconciliationsListInput, output: ReconciliationsListOutput, command: false, args: () => ({}) }),
  "payment.charge_cancel": route({ rpc: "payment_charge_cancel", input: ChargeCancelInput, output: ChargeOutput, command: true, args: (i) => ({ p_charge_id: i.charge_id, p_expected_version: i.expected_version }) }),
  "payment.refund": route({ rpc: "payment_refund_request", input: RefundRequestInput, output: RefundOutput, command: true, args: (i) => ({ p_charge_id: i.charge_id, p_reason: i.reason }) }),
};
/** Criação: mesma autorização/idempotência do rpc-handler, com a saída bruta (token) pós-processada aqui. */
const CREATE_ROUTES: Record<string, Route> = {
  "payment.charge_create": route({ rpc: "payment_charge_create", input: ChargeCreateInput, output: ChargeCreateRpcBody, command: true, args: (i) => ({ p_receivable_id: i.receivable_id, p_provider: i.provider }) }),
};

const ROUTE_RE = /\/payments\/([a-z_.]+)(?:\/([a-z_]+))?\/?$/;
const PUBLIC_RPC = { "payment.link_view": "payment_link_view" } as const;

export function createPaymentsHandler(deps: PaymentsDeps) {
  const clock = deps.clock ?? systemClock;
  if (deps.syncSecret.length < 32) throw new Error("PAYMENTS_SYNC_SECRET precisa de pelo menos 32 caracteres");
  const owner = createRpcHandler("payments", PAYMENTS_ROUTES, deps);
  const creator = createRpcHandler("payments", CREATE_ROUTES, deps);
  const json = async (res: Response) => (await res.clone().json().catch(() => null)) as { data?: unknown } | null;
  const passthrough = (res: Response, cors: Record<string, string>) =>
    new Response(res.body, { status: res.status, headers: { ...Object.fromEntries(res.headers), ...cors } });

  return async (req: Request): Promise<Response> => {
    const m = ROUTE_RE.exec(new URL(req.url).pathname);
    const name = m?.[1] ?? "";
    const started = clock.now().getTime();
    const requestId = requestIdFrom(req);
    const cors = corsHeaders(req, deps.allowedOrigins);
    let res: Response;
    if (name === "payment.webhook") res = await webhook(req, m?.[2] ?? "", requestId);
    else if (name === "payment.sync") res = await sync(req, requestId);
    else if (name === "payment.link_view") res = await publicView(req, requestId, cors);
    else if (name === "payment.sim_pay") res = await simPay(req, requestId, cors);
    else if (name === "payment.charge_create") res = await create(req, requestId, cors);
    else if (name === "payment.charge_cancel") res = await cancel(req, cors);
    else if (name === "payment.refund") res = await refund(req, requestId, cors);
    else if (name === "payment.reconcile") res = await reconcile(req, requestId, cors);
    else return owner(req);
    deps.log?.({ fn: "payments", route: name, request_id: requestId, status: res.status, ms: clock.now().getTime() - started });
    return res;
  };

  /** Cria no banco (creating), pede ao provedor, grava o resultado pelo backend e devolve a cobrança com o link. */
  async function create(req: Request, requestId: string, cors: Record<string, string>): Promise<Response> {
    const peek = await req.clone().json().catch(() => null) as { provider?: unknown } | null;
    if (peek?.provider === "psp" && !deps.providers.psp?.configured) {
      return fail("PROVIDER_UNAVAILABLE", requestId, { message: "O provedor de pagamento não está configurado neste ambiente.", extra: cors });
    }
    const res = await creator(req);
    if (!res.ok) return passthrough(res, cors);
    const body = ChargeCreateRpcBody.safeParse((await json(res))?.data);
    if (!body.success) return fail("INTERNAL_ERROR", requestId, { extra: cors });
    let charge = body.data.charge;
    const provider = deps.providers[charge.provider];
    if (charge.status === "creating") {
      let outcome: Awaited<ReturnType<PaymentProviderPort["createCharge"]>>;
      if (!provider?.configured) outcome = { outcome: "failed", reason: "provider_not_configured" };
      else {
        try {
          outcome = await provider.createCharge({ ref: `chg:${charge.id}`, tenant_id: req.headers.get(TENANT_HEADER) ?? "", amount_cents: charge.amount_cents,
            description: charge.description, expires_at: new Date(clock.now().getTime() + CHARGE_TTL_MIN * 60_000).toISOString() });
        } catch {
          outcome = { outcome: "unknown" };
        }
      }
      const r = await deps.serviceRpc("payment_charge_result", {
        p_charge_id: charge.id, p_outcome: outcome.outcome,
        p_external_id: outcome.outcome === "pending" ? outcome.external_id : null,
        p_pix_code: outcome.outcome === "pending" ? outcome.pix_code : null,
        p_checkout_url: outcome.outcome === "pending" ? outcome.checkout_url : null,
        p_expires_at: outcome.outcome === "pending" ? outcome.expires_at : null,
        p_reason: outcome.outcome === "failed" ? outcome.reason : null,
      }).catch(() => null);
      const updated = ChargeOutput.shape.charge.safeParse((r?.data as { charge?: unknown } | null)?.charge);
      if (updated.success) charge = updated.data;
      else if (outcome.outcome !== "unknown") return fail("PROVIDER_UNAVAILABLE", requestId, { extra: cors });
      else charge = { ...charge, status: "unknown" };
    }
    // Token no FRAGMENTO (não vai ao servidor nem a logs de acesso), como nos links de oferta e orçamento.
    const pay_url = `${deps.publicAppUrl.replace(/\/$/, "")}/pagar#t=${body.data.link_token}`;
    return ok({ charge, pay_url }, requestId, clock, 201, cors);
  }

  async function cancel(req: Request, cors: Record<string, string>): Promise<Response> {
    const res = await owner(req);
    if (!res.ok) return res;
    const data = (await json(res))?.data as { charge?: PaymentCharge } | undefined;
    const charge = data?.charge;
    const provider = charge ? deps.providers[charge.provider] : undefined;
    if (charge?.external_id && provider?.configured) await provider.cancel(charge.external_id).catch(() => undefined);
    return passthrough(res, cors);
  }

  /** Pede o estorno no banco (requested), pede ao PSP e grava a resposta pelo backend. */
  async function refund(req: Request, requestId: string, cors: Record<string, string>): Promise<Response> {
    const res = await owner(req);
    if (!res.ok) return res;
    const data = (await json(res))?.data as { refund?: PaymentRefund } | undefined;
    let r = data?.refund;
    if (!r) return fail("INTERNAL_ERROR", requestId, { extra: cors });
    if (r.status === "requested") {
      const chargeExternal = r.charge_external_id ?? null;
      const psp = deps.providers[r.charge_provider ?? "psp"];
      let outcome: Awaited<ReturnType<PaymentProviderPort["refund"]>>;
      if (!chargeExternal || !psp?.configured) outcome = { outcome: "failed", reason: "provider_not_configured" };
      else {
        try {
          outcome = await psp.refund(chargeExternal, r.amount_cents, `rf:${r.id}`);
        } catch {
          outcome = { outcome: "unknown" };
        }
      }
      const result = await deps.serviceRpc("payment_refund_result", { p_refund_id: r.id, p_outcome: outcome.outcome,
        p_external_id: outcome.outcome === "done" ? outcome.external_id : null, p_reason: outcome.outcome === "failed" ? outcome.reason : null }).catch(() => null);
      const updated = RefundOutput.shape.refund.safeParse((result?.data as { refund?: unknown } | null)?.refund);
      if (updated.success) r = updated.data;
      else r = { ...r, status: "unknown" };
    }
    return ok({ refund: r }, requestId, clock, 201, cors);
  }

  /** Conciliação: relatório do PSP do dia (pela porta) → RPC que compara e grava as diferenças. */
  async function reconcile(req: Request, requestId: string, cors: Record<string, string>): Promise<Response> {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (req.method !== "POST") return fail("VALIDATION_ERROR", requestId, { message: "Use POST.", extra: cors });
    const auth = req.headers.get("Authorization") ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    if (!token) return fail("AUTH_REQUIRED", requestId, { extra: cors });
    const tenantId = req.headers.get(TENANT_HEADER);
    if (!isUuid(tenantId)) return fail("VALIDATION_ERROR", requestId, { field: "tenant_id", message: "Selecione um negócio.", extra: cors });
    const key = IdempotencyKey.safeParse(req.headers.get(IDEMPOTENCY_HEADER));
    if (!key.success) return fail("VALIDATION_ERROR", requestId, { field: "idempotency_key", message: "Envie o header Idempotency-Key.", extra: cors });
    const input = ReconcileInput.safeParse(await req.json().catch(() => null));
    if (!input.success) return fail("VALIDATION_ERROR", requestId, { field: input.error.issues[0]?.path.map(String).join(".") || undefined, extra: cors });
    const provider = deps.providers[input.data.provider];
    if (!provider?.configured) return fail("PROVIDER_UNAVAILABLE", requestId, { message: "O provedor não está configurado neste ambiente.", extra: cors });
    const report = await provider.report(tenantId, input.data.day).catch(() => null);
    if (!report) return fail("PROVIDER_UNAVAILABLE", requestId, { message: "O provedor não entregou o relatório do dia. Nada foi gravado.", extra: cors });
    let r: RpcResult;
    try {
      r = await deps.rpc(token, "payment_reconcile", {
        p_tenant_id: tenantId, p_provider: input.data.provider, p_day: input.data.day, p_report: report,
        p_idem_key: key.data, p_request_hash: await sha256Hex(canonicalJson({ operation: "payment.reconcile", input: input.data })), p_request_id: requestId,
      });
    } catch {
      return fail("PROVIDER_UNAVAILABLE", requestId, { extra: cors });
    }
    if (r.error) {
      const mapped = mapDbError(r.error);
      return fail(mapped.code, requestId, { field: mapped.field, extra: cors });
    }
    const env = r.data as { status_code?: number; body?: unknown } | null;
    const parsed = ReconcileOutput.safeParse(env?.body);
    if (!parsed.success) return fail("INTERNAL_ERROR", requestId, { extra: cors });
    return ok(parsed.data, requestId, clock, env?.status_code === 201 ? 201 : 200, cors);
  }

  async function readToken(req: Request, cors: Record<string, string>, requestId: string): Promise<{ body: unknown; token: string } | Response> {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (req.method !== "POST") return fail("VALIDATION_ERROR", requestId, { message: "Use POST.", extra: cors });
    let body: unknown;
    try {
      body = JSON.parse((await req.text()).slice(0, 4096));
    } catch {
      return fail("NOT_FOUND", requestId, { extra: cors });
    }
    const token = PaymentLinkInput.safeParse(body);
    if (!token.success) return fail("NOT_FOUND", requestId, { extra: cors });
    return { body, token: token.data.token };
  }

  async function publicView(req: Request, requestId: string, cors: Record<string, string>): Promise<Response> {
    const t = await readToken(req, cors, requestId);
    if (t instanceof Response) return t;
    let r: RpcResult;
    try {
      r = await deps.anonRpc(PUBLIC_RPC["payment.link_view"], { p_token: t.token });
    } catch {
      return fail("PROVIDER_UNAVAILABLE", requestId, { extra: cors });
    }
    if (r.error) return fail(mapDbError(r.error).code, requestId, { extra: cors });
    const parsed = PaymentLinkView.safeParse(r.data);
    if (!parsed.success) return fail("INTERNAL_ERROR", requestId, { extra: cors });
    return ok(parsed.data, requestId, clock, 200, cors);
  }

  /** Só cobrança SIMULADA pendente: o PSP fictício muda o estado e (salvo notify=false) notifica pelo webhook assinado. */
  async function simPay(req: Request, requestId: string, cors: Record<string, string>): Promise<Response> {
    const t = await readToken(req, cors, requestId);
    if (t instanceof Response) return t;
    const input = SimPayInput.safeParse(t.body);
    if (!input.success) return fail("VALIDATION_ERROR", requestId, { field: input.error.issues[0]?.path.map(String).join(".") || undefined, extra: cors });
    const view = await deps.anonRpc("payment_link_view", { p_token: t.token }).catch(() => null);
    if (!view || view.error) return fail(view?.error ? mapDbError(view.error).code : "PROVIDER_UNAVAILABLE", requestId, { extra: cors });
    const v = PaymentLinkView.safeParse(view.data);
    if (!v.success) return fail("INTERNAL_ERROR", requestId, { extra: cors });
    if (v.data.provider !== "simulated") return fail("POLICY_REJECTED", requestId, { field: "provider", extra: cors });
    if (v.data.status !== "pending") return ok({ status: v.data.status, applied: 0, duplicates: 0 }, requestId, clock, 200, cors);
    const lookup = await deps.serviceRpc("payment_charge_lookup", { p_charge_id: v.data.charge_id }).catch(() => null);
    const externalId = ((lookup?.data as { charge?: { external_id?: string | null } } | null)?.charge?.external_id) ?? null;
    if (!externalId) return fail("POLICY_REJECTED", requestId, { field: "status", extra: cors });
    const moved = await deps.serviceRpc("payment_sim_transition", { p_external_id: externalId, p_status: input.data.outcome }).catch(() => null);
    const row = moved?.data as { status?: string; amount_cents?: number; paid_at?: string | null; changed?: boolean } | null;
    if (!row?.status) return fail("PROVIDER_UNAVAILABLE", requestId, { extra: cors });
    if (!input.data.notify) {
      // Webhook "perdido": o banco continua pendente; a conciliação lista e o sync resolve.
      return ok({ status: "pending", applied: 0, duplicates: 0 }, requestId, clock, 200, cors);
    }
    const event: PaymentEvent = input.data.outcome === "paid"
      ? { external_event_id: `sim:${externalId}:paid`, kind: "charge.paid", external_id: externalId, amount_cents: row.amount_cents, paid_at: row.paid_at ?? undefined }
      : { external_event_id: `sim:${externalId}:expired`, kind: "charge.expired", external_id: externalId };
    const raw = JSON.stringify({ events: [event] });
    const res = await webhook(new Request("http://internal/functions/v1/payments/payment.webhook/simulated", {
      method: "POST", headers: { "Content-Type": "application/json", [SIGNATURE_HEADER]: await signSimulatedBody(deps.simulatedSecret, raw) }, body: raw }), "simulated", requestId);
    const out = await res.json().catch(() => null) as { data?: { applied: number; duplicates: number } } | null;
    if (!res.ok || !out?.data) return new Response(JSON.stringify(out), { status: res.status, headers: { "Content-Type": "application/json; charset=utf-8", ...cors } });
    const parsed = SimPayOutput.safeParse({ status: input.data.outcome === "paid" ? "paid" : "expired", ...out.data });
    return parsed.success ? ok(parsed.data, requestId, clock, 200, cors) : fail("INTERNAL_ERROR", requestId, { extra: cors });
  }

  async function webhook(req: Request, providerName: string, requestId: string): Promise<Response> {
    const parsedName = PaymentProvider.safeParse(providerName);
    const provider = parsedName.success ? deps.providers[parsedName.data] : undefined;
    if (!provider) return fail("NOT_FOUND", requestId);
    if (req.method !== "POST") return fail("VALIDATION_ERROR", requestId, { message: "Use POST." });
    const raw = await req.text().catch(() => "");
    if (new TextEncoder().encode(raw).byteLength > MAX_WEBHOOK_BYTES) return fail("VALIDATION_ERROR", requestId, { message: "Corpo grande demais." });
    if (!(await provider.verifySignature(raw, req.headers.get(SIGNATURE_HEADER)))) return fail("AUTH_REQUIRED", requestId);
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return fail("VALIDATION_ERROR", requestId, { message: "JSON inválido." });
    }
    const events = provider.normalize(body);
    if (events.length === 0) return ok({ applied: 0, duplicates: 0 }, requestId, clock);
    let r: RpcResult;
    try {
      r = await deps.serviceRpc("payment_webhook_ingest", { p_provider: provider.name, p_events: events });
    } catch {
      return fail("PROVIDER_UNAVAILABLE", requestId); // o PSP reenvia; o banco deduplica
    }
    if (r.error) return fail(mapDbError(r.error).code, requestId);
    const parsed = zod.object({ applied: zod.int().min(0), duplicates: zod.int().min(0) }).safeParse(r.data);
    return parsed.success ? ok(parsed.data, requestId, clock) : fail("INTERNAL_ERROR", requestId);
  }

  /** Consulta ativa: cobranças sem resposta há 1 min ou pendentes vencidas. O PSP diz; o banco grava. */
  async function sync(req: Request, requestId: string): Promise<Response> {
    if (req.method !== "POST") return fail("VALIDATION_ERROR", requestId, { message: "Use POST." });
    const given = req.headers.get(SYNC_SECRET_HEADER) ?? "";
    if (!sameHex(await hmacSha256Hex("k", given), await hmacSha256Hex("k", deps.syncSecret))) return fail("AUTH_REQUIRED", requestId);
    const result = { provider_configured: true, checked: 0, settled: 0, closed: 0, still_unknown: 0 };
    let claim: RpcResult;
    try {
      claim = await deps.serviceRpc("payment_sync_claim", { p_batch: 50 });
    } catch {
      return fail("PROVIDER_UNAVAILABLE", requestId);
    }
    if (claim.error) return fail(mapDbError(claim.error).code, requestId);
    const items = ((claim.data as { items?: { charge_id: string; provider: z.infer<typeof PaymentProvider>; external_id: string | null }[] } | null)?.items ?? []);
    for (const item of items) {
      result.checked++;
      const provider = deps.providers[item.provider];
      if (!provider?.configured) {
        result.provider_configured = false;
        result.still_unknown++;
        continue;
      }
      let status: Awaited<ReturnType<PaymentProviderPort["status"]>> = null;
      if (item.external_id) status = await provider.status(item.external_id).catch(() => null);
      else if (provider.name === "simulated") status = { status: "failed" }; // o PSP fictício nunca registrou a cobrança
      const r = await deps.serviceRpc("payment_sync_result", { p_charge_id: item.charge_id, p_status: status?.status ?? null,
        p_paid_cents: status?.paid_cents ?? null, p_paid_at: status?.paid_at ?? null, p_external_id: item.external_id }).catch(() => null);
      const outcome = (r?.data as { outcome?: string } | null)?.outcome ?? "still_unknown";
      if (outcome === "entry" || outcome === "receivable_cancelled" || outcome === "already_settled") result.settled++;
      else if (outcome === "still_unknown" || outcome === "unmatched") result.still_unknown++;
      else result.closed++;
    }
    const parsed = SyncOutput.safeParse(result);
    return parsed.success ? ok(parsed.data, requestId, clock) : fail("INTERNAL_ERROR", requestId);
  }
}
