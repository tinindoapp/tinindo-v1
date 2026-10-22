// Recebíveis, pagamentos manuais e pacotes de sessões (P07).
// Agendar não significa receber; pagamento manual é identificado como manual.
import { z } from "zod";
import { Cents, IsoDateTime, TimeRange, TimeZone, Uuid } from "./common.ts";

export const PaymentMethod = z.enum(["pix", "cash", "card", "transfer", "other"]);
/** Origem do registro: `manual` (dono) ou `provider` (P14: evidência do PSP pelo webhook ou consulta). */
export const PaymentSource = z.enum(["manual", "provider"]);
export const ReceivableStatus = z.enum(["open", "partially_paid", "paid", "cancelled"]);

export const FinanceRecordPaymentInput = z.object({
  receivable_id: Uuid,
  amount_cents: Cents.min(1),
  method: PaymentMethod,
  received_at: IsoDateTime,
});
export const PaymentEntry = z.object({
  id: Uuid,
  tenant_id: Uuid,
  customer_id: Uuid.nullable(),
  amount_cents: Cents,
  method: PaymentMethod,
  source: PaymentSource,
  received_at: IsoDateTime,
  reversal_of: Uuid.nullable(),
});

export const FinanceSummaryInput = z.object({
  period: TimeRange,
  timezone: TimeZone,
});
export const FinanceSummaryOutput = z.object({
  period: TimeRange,
  /** Fuso do negócio, para exibir o período (aditivo; ADR-0009). */
  timezone: z.string().optional(),
  received_cents: Cents,
  spent_cents: Cents,
  receivable_open_cents: Cents,
  /** Quantos registros sustentam os números (cobertura explícita). */
  records_count: z.int().min(0),
  as_of: IsoDateTime,
  coverage_note: z.string().max(280),
});

export const PackageConsumeInput = z.object({
  package_id: Uuid,
  booking_id: Uuid,
  /** Evento de origem (ex.: booking.completed.v1) para débito único. */
  event_id: Uuid,
});
export const PackageBalance = z.object({
  package_id: Uuid,
  purchased_credits: z.int().min(1),
  remaining_credits: z.int().min(0),
  expires_at: IsoDateTime.nullable(),
});

// ---------------------------------------------------------------------------
// Operações complementares do caixa (P07). Aditivas ao v1; ver ADR-0009.
// ---------------------------------------------------------------------------

export const PaymentRecord = PaymentEntry.extend({
  receivable_id: Uuid,
  /** true quando já existe estorno vinculado a este recebimento. */
  reversed: z.boolean(),
});
export type PaymentRecord = z.infer<typeof PaymentRecord>;

export const Receivable = z.object({
  id: Uuid,
  customer_id: Uuid.nullable(),
  booking_id: Uuid.nullable(),
  package_id: Uuid.nullable(),
  description: z.string().min(1).max(120),
  amount_cents: Cents.min(1),
  paid_cents: Cents,
  open_cents: Cents,
  due_at: IsoDateTime.nullable(),
  status: ReceivableStatus,
  version: z.int().min(1),
  created_at: IsoDateTime,
});
export type Receivable = z.infer<typeof Receivable>;
export const ReceivableOutput = z.object({ receivable: Receivable });

export const FinanceCreateReceivableInput = z.object({
  customer_id: Uuid.nullable().default(null),
  description: z.string().trim().min(1).max(120),
  amount_cents: Cents.min(1),
  due_at: IsoDateTime.nullable().default(null),
});
/** Cobrança de um atendimento pelo preço combinado (congelado na reserva). */
export const FinanceChargeBookingInput = z.object({
  booking_id: Uuid,
  due_at: IsoDateTime.nullable().default(null),
});
export const FinanceCancelReceivableInput = z.object({ receivable_id: Uuid, expected_version: z.int().min(1) });

export const FinanceReversePaymentInput = z.object({
  payment_id: Uuid,
  reason: z.string().trim().min(1).max(280),
});

export const ExpenseCategory = z.enum(["supplies", "rent", "utilities", "fees", "transport", "marketing", "other"]);
export type ExpenseCategory = z.infer<typeof ExpenseCategory>;
export const ExpenseEntry = z.object({
  id: Uuid,
  amount_cents: Cents.min(1),
  paid_at: IsoDateTime,
  category: ExpenseCategory,
  description: z.string().max(120).nullable(),
  reversal_of: Uuid.nullable(),
  reversed: z.boolean(),
});
export type ExpenseEntry = z.infer<typeof ExpenseEntry>;
export const FinanceRecordExpenseInput = z.object({
  amount_cents: Cents.min(1),
  paid_at: IsoDateTime,
  category: ExpenseCategory,
  description: z.string().trim().max(120).nullable().default(null),
});
export const FinanceReverseExpenseInput = z.object({ expense_id: Uuid });

export const FinancePeriodInput = z.object({ period: TimeRange });
export const FinanceLedgerOutput = z.object({
  /** Abertos (qualquer data) + criados no período. */
  receivables: z.array(Receivable).max(200),
  payments: z.array(PaymentRecord).max(200),
  expenses: z.array(ExpenseEntry).max(200),
});

export const UnchargedBooking = z.object({
  booking_id: Uuid,
  customer_id: Uuid.nullable(),
  service_id: Uuid,
  starts_at: IsoDateTime,
  agreed_price_cents: Cents.nullable(),
  /** Evento booking.completed.v1 que autoriza o débito de crédito (package.consume). */
  completed_event_id: Uuid.nullable(),
  /** Pacotes do mesmo cliente e serviço, válidos e com saldo. */
  package_ids: z.array(Uuid),
});
export type UnchargedBooking = z.infer<typeof UnchargedBooking>;
export const FinanceUnchargedOutput = z.object({ bookings: z.array(UnchargedBooking).max(100) });

export const PackageSellInput = z.object({
  customer_id: Uuid,
  service_id: Uuid,
  credits: z.int().min(1).max(500),
  total_price_cents: Cents.min(1),
  expires_at: IsoDateTime.nullable().default(null),
});
export const PackageSellOutput = z.object({ package: PackageBalance, receivable: Receivable });

export const PackageReverseInput = z.object({
  entry_id: Uuid,
  reason: z.string().trim().min(1).max(280),
});

export const SessionEntry = z.object({
  id: Uuid,
  booking_id: Uuid.nullable(),
  delta: z.union([z.literal(-1), z.literal(1)]),
  reason: z.enum(["consume", "reversal"]),
  reversal_of: Uuid.nullable(),
  created_at: IsoDateTime,
  reversed: z.boolean(),
});
export const PackageDetail = PackageBalance.extend({
  customer_id: Uuid,
  service_id: Uuid,
  total_price_cents: Cents,
  created_at: IsoDateTime,
  entries: z.array(SessionEntry).max(50),
});
export type PackageDetail = z.infer<typeof PackageDetail>;
export const PackageListInput = z.object({});
export const PackageListOutput = z.object({ packages: z.array(PackageDetail).max(200) });
