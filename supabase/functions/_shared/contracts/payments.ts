// Pagamento conectado (P14). Aditivos ao v1; ver ADR-0018.
// PSP atrás de porta ('simulated' | 'psp'). Pago só com evidência do provedor; 'unknown' exige consulta, nunca
// presunção. Estorno total, vinculado ao recebimento. Conciliação lista diferenças, não corrige em silêncio.
import { z } from "zod";
import { Cents, IsoDateTime, Uuid } from "./common.ts";

export const PaymentProvider = z.enum(["simulated", "psp"]);
export type PaymentProvider = z.infer<typeof PaymentProvider>;
export const ChargeStatus = z.enum(["creating", "pending", "paid", "expired", "cancelled", "failed", "unknown"]);
export type ChargeStatus = z.infer<typeof ChargeStatus>;
export const RefundStatus = z.enum(["requested", "done", "failed", "unknown"]);

export const PaymentCharge = z.object({
  id: Uuid,
  receivable_id: Uuid,
  customer_id: Uuid.nullable(),
  provider: PaymentProvider,
  /** true = PSP fictício: toda tela mostra "simulação". */
  simulated: z.boolean(),
  external_id: z.string().nullable(),
  amount_cents: Cents.min(1),
  description: z.string(),
  status: ChargeStatus,
  pix_code: z.string().nullable(),
  checkout_url: z.string().nullable(),
  expires_at: IsoDateTime.nullable(),
  paid_at: IsoDateTime.nullable(),
  paid_cents: Cents.nullable(),
  payment_entry_id: Uuid.nullable(),
  /** entry = baixa feita; receivable_cancelled = pago sem baixa possível (diferença na conciliação). */
  settlement: z.enum(["entry", "receivable_cancelled", "already_settled"]).nullable(),
  failure_reason: z.string().nullable(),
  refund_status: RefundStatus.nullable(),
  created_at: IsoDateTime,
  version: z.int().min(1),
});
export type PaymentCharge = z.infer<typeof PaymentCharge>;

export const PaymentRefund = z.object({
  id: Uuid,
  charge_id: Uuid,
  amount_cents: Cents.min(1),
  reason: z.string(),
  status: RefundStatus,
  external_id: z.string().nullable(),
  reversal_entry_id: Uuid.nullable(),
  failure_reason: z.string().nullable(),
  created_at: IsoDateTime,
  version: z.int().min(1),
  charge_external_id: z.string().nullable().optional(),
  charge_provider: PaymentProvider.optional(),
});
export type PaymentRefund = z.infer<typeof PaymentRefund>;

export const ChargeCreateInput = z.object({ receivable_id: Uuid, provider: PaymentProvider });
export const ChargeCreateOutput = z.object({
  charge: PaymentCharge,
  /** Link público de pagamento (token devolvido uma vez; só o hash fica no banco). */
  pay_url: z.string().nullable(),
});
export const ChargeCancelInput = z.object({ charge_id: Uuid, expected_version: z.int().min(1) });
export const ChargeOutput = z.object({ charge: PaymentCharge });
export const ChargesListInput = z.object({});
export const ChargesListOutput = z.object({ charges: z.array(PaymentCharge).max(200), refunds: z.array(PaymentRefund).max(200), unknown: z.int().min(0) });
export const RefundRequestInput = z.object({ charge_id: Uuid, reason: z.string().trim().min(1).max(280) });
export const RefundOutput = z.object({ refund: PaymentRefund });

export const ReconciliationDifference = z.object({
  kind: z.enum(["paid_without_entry", "entry_without_report", "amount_mismatch", "unknown_charge"]),
  charge_id: Uuid.optional(),
  external_id: z.string().nullable().optional(),
  amount_cents: Cents.optional(),
  report_cents: Cents.optional(),
  entry_cents: Cents.optional(),
  charge_status: z.string().optional(),
  settlement: z.string().nullable().optional(),
});
export const Reconciliation = z.object({
  id: Uuid,
  provider: PaymentProvider,
  /** AAAA-MM-DD no fuso do negócio. */
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  report_count: z.int().min(0),
  report_paid_cents: Cents,
  ledger_paid_cents: Cents,
  differences: z.array(ReconciliationDifference),
  created_at: IsoDateTime,
});
export type Reconciliation = z.infer<typeof Reconciliation>;
export const ReconcileInput = z.object({ provider: PaymentProvider, day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });
export const ReconcileOutput = z.object({ reconciliation: Reconciliation });
export const ReconciliationsListInput = z.object({});
export const ReconciliationsListOutput = z.object({ reconciliations: z.array(Reconciliation).max(60) });

/** Link público (anônimo, token no corpo de um POST). */
export const PaymentLinkInput = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) });
export const PaymentLinkView = z.object({
  charge_id: Uuid,
  business_name: z.string(),
  description: z.string(),
  amount_cents: Cents.min(1),
  provider: PaymentProvider,
  simulated: z.boolean(),
  status: ChargeStatus,
  pix_code: z.string().nullable(),
  checkout_url: z.string().nullable(),
  expires_at: IsoDateTime.nullable(),
  paid_at: IsoDateTime.nullable(),
});

/** Simulador (só cobrança simulada): o "cliente" paga pelo link ou o PSP fictício muda o estado; webhook assinado. */
export const SimPayInput = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  outcome: z.enum(["paid", "expired"]).default("paid"),
  /** false = o PSP marca pago mas o webhook "se perde": a conciliação e o sync precisam resolver. */
  notify: z.boolean().default(true),
});
export const SimPayOutput = z.object({ status: ChargeStatus, applied: z.int().min(0), duplicates: z.int().min(0) });

/** Resultado de uma rodada do sync (rota de sistema, por segredo). */
export const SyncOutput = z.object({ provider_configured: z.boolean(), checked: z.int().min(0), settled: z.int().min(0), closed: z.int().min(0), still_unknown: z.int().min(0) });
