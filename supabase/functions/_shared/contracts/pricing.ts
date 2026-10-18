// Cotação e regras de preço (P05). Cotação NÃO segura horário.
import { z } from "zod";
import {
  BasisPoints,
  Cents,
  Currency,
  IsoDateTime,
  TimeRange,
  Uuid,
  Version,
  WeeklyWindow,
} from "./common.ts";

export const QuoteReason = z.enum(["BASE_PRICE", "OFF_PEAK_APPROVED", "FLOOR_APPLIED"]);

export const Quote = z.object({
  quote_id: Uuid,
  service_id: Uuid,
  resource_id: Uuid,
  slot: TimeRange,
  currency: Currency,
  base_price_cents: Cents,
  final_price_cents: Cents,
  /** null quando não houver regra aplicada. */
  rule_version: z.int().min(1).nullable(),
  reason_code: QuoteReason,
  expires_at: IsoDateTime,
});
export type Quote = z.infer<typeof Quote>;

export const PricingQuoteInput = z.object({
  service_id: Uuid,
  resource_id: Uuid,
  slot: TimeRange,
});

export const PricingProposeRuleInput = z.object({
  service_id: Uuid,
  windows: z.array(WeeklyWindow).min(1).max(14),
  discount_bps: BasisPoints,
  max_discount_bps: BasisPoints,
  valid: TimeRange,
});
export const PricingRuleProposal = z.object({
  proposal_id: Uuid,
  service_id: Uuid,
  discount_bps: BasisPoints,
  /** Prévia de impacto; a regra continua inativa até publish. */
  preview: z.object({
    example_base_cents: Cents,
    example_final_cents: Cents,
    floor_cents: Cents,
    floor_is_manual_only: z.boolean(),
  }),
  version: Version,
  expires_at: IsoDateTime,
});

export const PricingPublishRuleInput = z.object({
  proposal_id: Uuid,
  approval_id: Uuid,
  expected_version: Version,
});
