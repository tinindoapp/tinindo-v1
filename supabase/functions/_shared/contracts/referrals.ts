// Indicação de colegas (P21). Aditivos ao v1; ver ADR-0021.
// O convite é o do P09 (professional_invites_peer). Aqui entra a adesão ELEGÍVEL (uso real medido pelo backend) e o
// benefício: crédito de franquia do assistente no mês. Nunca avaliação, nota ou posição. Um benefício por negócio
// indicado; autoindicação e duplicidade bloqueadas; teto mensal.
import { z } from "zod";
import { IsoDateTime, Uuid } from "./common.ts";
import { Profession } from "./context.ts";
import { ReferralState } from "./network.ts";

export const ReferralRules = z.object({
  min_customers: z.int().min(1),
  min_completed_bookings: z.int().min(1),
  window_days: z.int().min(1),
  reward_questions: z.int().min(1),
  monthly_cap: z.int().min(1),
});
export const ActivationStatus = z.enum(["awaiting_activity", "eligible", "rewarded", "blocked"]);
export const BlockReason = z.enum(["same_tenant", "duplicate", "window_expired"]);
export const ReferralActivation = z.object({
  status: ActivationStatus,
  block_reason: BlockReason.nullable(),
  /** Contagens medidas pelo backend (clientes, atendimentos concluídos); nunca dados pessoais. */
  checks: z.record(z.string(), z.unknown()),
  eligible_at: IsoDateTime.nullable(),
  rewarded_at: IsoDateTime.nullable(),
});
export const ReferralReward = z.object({
  id: Uuid,
  kind: z.literal("agent_questions"),
  amount: z.int().min(1),
  /** AAAA-MM-DD: mês em que o crédito vale. */
  period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  created_at: IsoDateTime,
});
export const ReferralInvite = z.object({
  referral_id: Uuid,
  invitee_name: z.string(),
  invitee_category: Profession.nullable(),
  created_at: IsoDateTime,
  expires_at: IsoDateTime,
  state: ReferralState,
  claimed_at: IsoDateTime.nullable(),
  activation: ReferralActivation.nullable(),
  reward: ReferralReward.nullable(),
});
export type ReferralInvite = z.infer<typeof ReferralInvite>;

export const ReferralDashboardInput = z.object({});
export const ReferralDashboardOutput = z.object({
  rules: ReferralRules,
  invites: z.array(ReferralInvite).max(100),
  summary: z.object({
    invites: z.int().min(0),
    claimed: z.int().min(0),
    rewarded: z.int().min(0),
    rewarded_this_month: z.int().min(0),
    bonus_this_month: z.int().min(0).nullable(),
    agent_limit: z.int().min(0).nullable(),
    agent_used: z.int().min(0).nullable(),
  }),
});
export type ReferralDashboard = z.infer<typeof ReferralDashboardOutput>;
export const ReferralRewardsListInput = z.object({});
export const ReferralRewardsListOutput = z.object({
  rewards: z.array(ReferralReward.extend({ referral_id: Uuid, invitee_name: z.string().nullable() })).max(100),
});
