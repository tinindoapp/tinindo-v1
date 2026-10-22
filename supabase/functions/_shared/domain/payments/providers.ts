// Porta do provedor de pagamento (P14). Dois adaptadores:
// * simulated: PSP fictício. O "outro lado" fica em payment_sim_ledger (backend); número do valor terminado em 99
//   centavos falha na criação; valor terminado em 98 centavos fica desconhecido na primeira cobrança (timeout) e a consulta resolve.
// * psp: esqueleto de um PSP real de Pix por cobrança (REST + webhook assinado por HMAC). Só com credenciais no
//   servidor; sem elas, `configured: false` e criar cobrança responde 503. Os caminhos e campos são um contrato
//   genérico documentado aqui e devem ser ajustados ao PSP contratado (decisão do dono do projeto, ADR-0018).
// Nenhum adaptador presume pago: 'unknown' só sai por consulta de status ou webhook. Nada de custódia.
import { z } from "zod";
import { hmacSha256Hex, verifyHubSignature } from "../messaging/providers.ts";

export interface ChargeRequest {
  ref: string;
  tenant_id: string;
  amount_cents: number;
  description: string;
  /** Validade pedida (ISO). O PSP pode devolver outra. */
  expires_at: string;
}
export type ChargeResult =
  | { outcome: "pending"; external_id: string; pix_code: string | null; checkout_url: string | null; expires_at: string | null }
  | { outcome: "failed"; reason: string }
  | { outcome: "unknown" };
export interface StatusResult { status: "pending" | "paid" | "expired" | "cancelled" | "failed"; paid_cents?: number; paid_at?: string | null }
export type RefundResult = { outcome: "done"; external_id: string } | { outcome: "failed"; reason: string } | { outcome: "unknown" };
export interface ReportItem { external_id: string; status: "paid" | "refunded"; amount_cents: number; paid_at: string | null }

/** Evento já normalizado para public.payment_webhook_ingest. */
export interface PaymentEvent {
  external_event_id: string;
  kind: "charge.paid" | "charge.expired" | "charge.failed" | "charge.cancelled" | "refund.done" | "refund.failed";
  external_id: string;
  amount_cents?: number;
  paid_at?: string;
  refund_external_id?: string;
  reason?: string;
}

export interface PaymentProviderPort {
  readonly name: "simulated" | "psp";
  readonly configured: boolean;
  createCharge(req: ChargeRequest): Promise<ChargeResult>;
  /** Consulta ativa. null = o PSP não respondeu (continua desconhecido). */
  status(externalId: string): Promise<StatusResult | null>;
  cancel(externalId: string): Promise<void>;
  refund(externalId: string, amountCents: number, ref: string): Promise<RefundResult>;
  /** Relatório do que o PSP recebeu no dia (fuso do negócio), para a conciliação. */
  report(tenantId: string, day: string): Promise<ReportItem[] | null>;
  verifySignature(rawBody: string, header: string | null): Promise<boolean>;
  normalize(body: unknown): PaymentEvent[];
}

export const PaymentWebhookBody = z.object({
  events: z.array(z.object({
    external_event_id: z.string().min(1).max(200),
    kind: z.enum(["charge.paid", "charge.expired", "charge.failed", "charge.cancelled", "refund.done", "refund.failed"]),
    external_id: z.string().min(1).max(120),
    amount_cents: z.int().min(0).optional(),
    paid_at: z.string().optional(),
    refund_external_id: z.string().max(120).optional(),
    reason: z.string().max(200).optional(),
  })).max(500),
});

// ---------------------------------------------------------------------------
// Simulado
// ---------------------------------------------------------------------------

export interface SimulatedPaymentDeps {
  secret: string;
  /** RPCs payment_sim_* (service_role) que guardam o "lado do PSP". */
  store(fn: string, args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
}

export function createSimulatedPaymentProvider(deps: SimulatedPaymentDeps): PaymentProviderPort {
  const unknownOnce = new Set<string>();
  const ledger = async (fn: string, args: Record<string, unknown>) => {
    const r = await deps.store(fn, args);
    if (r.error) throw new Error("sim_ledger_unavailable");
    return r.data as Record<string, unknown> | null;
  };
  return {
    name: "simulated",
    configured: deps.secret.length >= 16,
    async createCharge(req) {
      if (req.amount_cents % 100 === 99) return { outcome: "failed", reason: "amount_rejected" };
      // Valor terminado em 98: a PRIMEIRA cobrança desse valor no negócio fica sem resposta; a próxima tentativa responde.
      const once = `${req.tenant_id}:${req.amount_cents}`;
      if (req.amount_cents % 100 === 98 && !unknownOnce.has(once)) {
        unknownOnce.add(once);
        return { outcome: "unknown" };
      }
      const external_id = `sim-${req.ref.replace(/[^a-z0-9]/gi, "").slice(-24)}`;
      await ledger("payment_sim_create", { p_external_id: external_id, p_tenant_id: req.tenant_id, p_amount_cents: req.amount_cents, p_expires_at: req.expires_at });
      return { outcome: "pending", external_id, pix_code: `00020126SIMULADO${external_id}5204000053039865802BR`, checkout_url: null, expires_at: req.expires_at };
    },
    async status(externalId) {
      const row = await ledger("payment_sim_status", { p_external_id: externalId });
      if (!row) {
        // A criação ficou desconhecida e o PSP nunca a registrou: a cobrança não existe lá.
        return { status: "failed" };
      }
      const s = row.status as string;
      return { status: s === "refunded" ? "paid" : (s as StatusResult["status"]), paid_cents: row.amount_cents as number, paid_at: (row.paid_at as string | null) ?? null };
    },
    async cancel(externalId) {
      await ledger("payment_sim_transition", { p_external_id: externalId, p_status: "cancelled" });
    },
    async refund(externalId) {
      const row = await ledger("payment_sim_transition", { p_external_id: externalId, p_status: "refunded" });
      if (!row || row.status !== "refunded") return { outcome: "failed", reason: "not_paid" };
      return { outcome: "done", external_id: `rf-${externalId}` };
    },
    async report(tenantId, day) {
      const row = await ledger("payment_sim_report", { p_tenant_id: tenantId, p_day: day });
      return ((row?.items as ReportItem[] | undefined) ?? []);
    },
    verifySignature: (raw, header) => verifyHubSignature(deps.secret, raw, header),
    normalize(body) {
      const parsed = PaymentWebhookBody.safeParse(body);
      return parsed.success ? parsed.data.events : [];
    },
  };
}

/** Assina um corpo de webhook simulado (usado por sim.pay para passar pelo MESMO caminho do provedor real). */
export const signSimulatedBody = (secret: string, raw: string) => hmacSha256Hex(secret, raw).then((h) => `sha256=${h}`);

// ---------------------------------------------------------------------------
// PSP real (esqueleto). Contrato genérico: POST /charges, GET /charges/{id}, POST /charges/{id}/cancel,
// POST /charges/{id}/refunds, GET /settlements?day=AAAA-MM-DD; webhook {id, type, data:{charge_id, amount_cents, paid_at}}.
// ---------------------------------------------------------------------------

export interface PspDeps {
  baseUrl: string | null;
  apiKey: string | null;
  webhookSecret: string | null;
  fetch?: typeof fetch;
}

const PspWebhook = z.object({
  id: z.string(),
  type: z.string(),
  data: z.object({
    charge_id: z.string(),
    amount_cents: z.int().optional(),
    paid_at: z.string().optional(),
    refund_id: z.string().optional(),
    reason: z.string().optional(),
  }),
});
const KINDS: Record<string, PaymentEvent["kind"]> = {
  "charge.paid": "charge.paid", "charge.expired": "charge.expired", "charge.failed": "charge.failed", "charge.cancelled": "charge.cancelled",
  "refund.succeeded": "refund.done", "refund.failed": "refund.failed",
};

export function createPspProvider(deps: PspDeps): PaymentProviderPort {
  const doFetch = deps.fetch ?? fetch;
  const configured = !!deps.baseUrl && !!deps.apiKey && !!deps.webhookSecret;
  const base = (deps.baseUrl ?? "").replace(/\/$/, "");
  const call = async (path: string, init: RequestInit = {}): Promise<{ status: number; json: Record<string, unknown> | null } | null> => {
    try {
      const res = await doFetch(`${base}${path}`, {
        ...init, headers: { Authorization: `Bearer ${deps.apiKey}`, "Content-Type": "application/json", ...(init.headers ?? {}) }, signal: AbortSignal.timeout(10_000),
      });
      const json = await res.json().catch(() => null) as Record<string, unknown> | null;
      return { status: res.status, json };
    } catch {
      return null; // timeout ou rede: PODE ter acontecido. Nunca presumir.
    }
  };
  return {
    name: "psp",
    configured,
    async createCharge(req) {
      if (!configured) return { outcome: "unknown" };
      const r = await call("/charges", { method: "POST", headers: { "Idempotency-Key": req.ref }, body: JSON.stringify({ amount_cents: req.amount_cents, description: req.description, expires_at: req.expires_at, reference: req.ref }) });
      if (!r || r.status >= 500) return { outcome: "unknown" };
      if (r.status >= 400) return { outcome: "failed", reason: `psp_${r.status}${typeof r.json?.code === "string" ? `_${r.json.code}` : ""}` };
      const id = r.json?.id;
      if (typeof id !== "string") return { outcome: "unknown" };
      return { outcome: "pending", external_id: id, pix_code: typeof r.json?.pix_code === "string" ? r.json.pix_code : null,
        checkout_url: typeof r.json?.checkout_url === "string" ? r.json.checkout_url : null, expires_at: typeof r.json?.expires_at === "string" ? r.json.expires_at : req.expires_at };
    },
    async status(externalId) {
      if (!configured) return null;
      const r = await call(`/charges/${encodeURIComponent(externalId)}`);
      if (!r || r.status >= 500) return null;
      if (r.status === 404) return { status: "failed" };
      const s = r.json?.status;
      if (s !== "pending" && s !== "paid" && s !== "expired" && s !== "cancelled" && s !== "failed") return null;
      return { status: s, paid_cents: typeof r.json?.paid_cents === "number" ? r.json.paid_cents : undefined, paid_at: typeof r.json?.paid_at === "string" ? r.json.paid_at : null };
    },
    async cancel(externalId) {
      if (!configured) return;
      await call(`/charges/${encodeURIComponent(externalId)}/cancel`, { method: "POST" });
    },
    async refund(externalId, amountCents, ref) {
      if (!configured) return { outcome: "unknown" };
      const r = await call(`/charges/${encodeURIComponent(externalId)}/refunds`, { method: "POST", headers: { "Idempotency-Key": ref }, body: JSON.stringify({ amount_cents: amountCents }) });
      if (!r || r.status >= 500) return { outcome: "unknown" };
      if (r.status >= 400) return { outcome: "failed", reason: `psp_${r.status}` };
      return typeof r.json?.id === "string" ? { outcome: "done", external_id: r.json.id } : { outcome: "unknown" };
    },
    async report(_tenantId, day) {
      if (!configured) return null;
      const r = await call(`/settlements?day=${encodeURIComponent(day)}`);
      if (!r || r.status >= 400) return null;
      const items = Array.isArray(r.json?.items) ? r.json.items as Record<string, unknown>[] : [];
      return items.flatMap((i) => typeof i.charge_id === "string" && typeof i.amount_cents === "number" && (i.status === "paid" || i.status === "refunded")
        ? [{ external_id: i.charge_id, status: i.status, amount_cents: i.amount_cents, paid_at: typeof i.paid_at === "string" ? i.paid_at : null }] : []);
    },
    verifySignature: (raw, header) => (deps.webhookSecret ? verifyHubSignature(deps.webhookSecret, raw, header) : Promise.resolve(false)),
    normalize(body) {
      const parsed = PspWebhook.safeParse(body);
      if (!parsed.success) return [];
      const kind = KINDS[parsed.data.type];
      if (!kind) return [];
      const d = parsed.data.data;
      return [{ external_event_id: parsed.data.id, kind, external_id: d.charge_id, amount_cents: d.amount_cents, paid_at: d.paid_at, refund_external_id: d.refund_id, reason: d.reason }];
    },
  };
}
