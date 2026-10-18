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
import { ActionApproveInput } from "./agent.ts";

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
  /** Margem de contribuição alvo para o piso econômico (doc06). Aditivo; padrão 0. */
  target_margin_bps: BasisPoints.default(0),
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
    /** Campos aditivos (P05): detalhe do cálculo mostrado antes de aprovar. */
    economic_floor_cents: Cents.nullable().optional(),
    effective_discount_bps: BasisPoints.optional(),
    reason: QuoteReason.optional(),
  }),
  version: Version,
  expires_at: IsoDateTime,
  // Campos aditivos (P05): o que exatamente será aprovado.
  windows: z.array(WeeklyWindow).optional(),
  max_discount_bps: BasisPoints.optional(),
  target_margin_bps: BasisPoints.optional(),
  valid: TimeRange.optional(),
  /** sha256 do payload normalizado; a aprovação vale só para este hash nesta versão. */
  payload_hash: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  status: z.enum(["proposed", "published", "discarded"]).optional(),
});
export type PricingRuleProposal = z.infer<typeof PricingRuleProposal>;

export const PricingPublishRuleInput = z.object({
  proposal_id: Uuid,
  approval_id: Uuid,
  expected_version: Version,
});

// ---------------------------------------------------------------------------
// Aprovação, publicação e leitura das regras (P05). Aditivas ao v1; ver ADR-0010.
// ---------------------------------------------------------------------------

/** Aprovação do dono, no mesmo formato de action.approve (P08): hash + versão + validade. */
export const PricingApproveRuleInput = ActionApproveInput;

export const PricingRule = z.object({
  rule_id: Uuid,
  service_id: Uuid,
  rule_version: z.int().min(1),
  windows: z.array(WeeklyWindow),
  discount_bps: BasisPoints,
  max_discount_bps: BasisPoints,
  target_margin_bps: BasisPoints,
  valid: TimeRange,
  active: z.boolean(),
  published_at: IsoDateTime,
  version: Version,
});
export type PricingRule = z.infer<typeof PricingRule>;
export const PricingRuleOutput = z.object({ rule: PricingRule });

export const PricingListRulesInput = z.object({});
export const PricingListRulesOutput = z.object({
  rules: z.array(PricingRule).max(100),
  proposals: z.array(PricingRuleProposal).max(20),
});
export const PricingDeactivateRuleInput = z.object({ rule_id: Uuid, expected_version: Version });
