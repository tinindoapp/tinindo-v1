// Campanhas e experimentos (P19). Aditivos ao v1; ver ADR-0022.
// Segmentos só por dados existentes; público só com consentimento de marketing (P13); limites de envios e de gasto
// aplicados no servidor; oferta vinculada (desconto ou regra de preço do P05); grupo de controle sorteado no servidor;
// resultado por braço com intervalo. Sem controle, o resultado é observação; nunca efeito afirmado fora do desenho.
import { z } from "zod";
import { IsoDateTime, Uuid } from "./common.ts";

export const CampaignSegment = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("inactive_days"), days: z.int().min(14).max(365) }),
  z.object({ kind: z.literal("credit_remaining") }),
  z.object({ kind: z.literal("marketing_all") }),
]);
export type CampaignSegment = z.infer<typeof CampaignSegment>;
export const CampaignOffer = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }),
  z.object({ kind: z.literal("discount_pct"), pct: z.int().min(5).max(50), service_id: Uuid.nullable().default(null) }),
  z.object({ kind: z.literal("pricing_rule"), pricing_rule_id: Uuid, service_id: Uuid.nullable().optional() }),
]);
export type CampaignOffer = z.infer<typeof CampaignOffer>;
export const CampaignStatus = z.enum(["running", "closed", "cancelled"]);
export const CampaignDesign = z.enum(["randomized_control", "observational"]);
export const CampaignVerdict = z.enum(["difference_detected", "no_difference_detected", "inconclusive", "observation_only"]);

export const AudienceMember = z.object({
  customer_id: Uuid,
  name: z.string(),
  last_visit_at: IsoDateTime.nullable(),
  has_channel: z.boolean(),
  credits_remaining: z.int().min(0),
});
export const CampaignPreviewInput = z.object({ segment: CampaignSegment });
export const CampaignPreviewOutput = z.object({
  segment: CampaignSegment,
  customers: z.array(AudienceMember).max(500),
  /** Hash do público visto: a aprovação precisa citá-lo. */
  audience_hash: z.string().regex(/^[0-9a-f]{64}$/),
  audience_count: z.int().min(0),
});

export const CampaignArm = z.object({
  n: z.int().min(0),
  converted: z.int().min(0),
  rate: z.number().min(0).max(1).nullable(),
  /** Intervalo de Wilson 95%. */
  ci: z.tuple([z.number(), z.number()]),
  revenue_cents: z.int().min(0),
  sent: z.int().min(0),
  manual: z.int().min(0),
  skipped: z.int().min(0),
  pending: z.int().min(0),
});
export const CampaignResult = z.object({
  design: CampaignDesign,
  final: z.boolean(),
  window: z.object({ starts_at: IsoDateTime, ends_at: IsoDateTime }),
  arms: z.object({ treatment: CampaignArm, control: CampaignArm }),
  /** Diferença tratado − controle com intervalo (Newcombe); null sem controle ou com braços pequenos. */
  difference: z.object({ value: z.number(), ci: z.tuple([z.number(), z.number()]) }).nullable(),
  verdict: CampaignVerdict,
});
export type CampaignResult = z.infer<typeof CampaignResult>;
export const Campaign = z.object({
  id: Uuid,
  name: z.string(),
  segment: CampaignSegment,
  audience_count: z.int().min(0),
  control_pct: z.int().min(0).max(50),
  control_count: z.int().min(0),
  treatment_count: z.int().min(0),
  max_sends: z.int().min(1).max(500),
  spend_cap_cents: z.int().min(0).nullable(),
  estimated_cost_cents: z.int().min(0),
  offer: CampaignOffer,
  offer_text: z.string(),
  window_days: z.int().min(7).max(60),
  status: CampaignStatus,
  starts_at: IsoDateTime,
  ends_at: IsoDateTime,
  closed_at: IsoDateTime.nullable(),
  result: CampaignResult,
  created_at: IsoDateTime,
  version: z.int().min(1),
});
export type Campaign = z.infer<typeof Campaign>;

export const CampaignApproveInput = z.object({
  name: z.string().trim().min(1).max(80),
  segment: CampaignSegment,
  audience_hash: z.string().regex(/^[0-9a-f]{64}$/),
  /** Percentual sorteado para o controle; 0 = observação (sem efeito afirmável). */
  control_pct: z.int().min(0).max(50).default(20),
  max_sends: z.int().min(1).max(500),
  spend_cap_cents: z.int().min(0).nullable().default(null),
  window_days: z.int().min(7).max(60).default(14),
  offer: CampaignOffer.default({ kind: "none" }),
});
export const CampaignOutput = z.object({ campaign: Campaign });
export const CampaignListInput = z.object({});
export const CampaignListOutput = z.object({ campaigns: z.array(Campaign).max(50) });
export const CampaignGetInput = z.object({ campaign_id: Uuid });
export const CampaignMember = z.object({
  customer_id: Uuid,
  customer_name: z.string(),
  arm: z.enum(["treatment", "control"]),
  step_status: z.string().nullable(),
  converted: z.boolean(),
});
export const CampaignGetOutput = z.object({ campaign: Campaign, members: z.array(CampaignMember).max(500) });
export const CampaignCancelInput = z.object({ campaign_id: Uuid, expected_version: z.int().min(1) });
