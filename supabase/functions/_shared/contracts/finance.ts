// Recebíveis, pagamentos manuais e pacotes de sessões (P07).
// Agendar não significa receber; pagamento manual é identificado como manual.
import { z } from "zod";
import { Cents, IsoDateTime, TimeRange, TimeZone, Uuid } from "./common.ts";

export const PaymentMethod = z.enum(["pix", "cash", "card", "transfer", "other"]);
/** Origem do registro. Só `manual` existe no piloto; PSP vem com evidência do provedor. */
export const PaymentSource = z.enum(["manual"]);
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
