// Portas do módulo Indicações (P21). Demonstração: emulação na aba, sempre rotulada; servidor: Edge Function `referrals`.
import type { ReferralDashboard, ReferralInvite } from "@contracts";

export type { ReferralDashboard, ReferralInvite };
export type ReferralReward = ReferralDashboard["invites"][number]["reward"] & { referral_id: string; invitee_name: string | null };

export interface ReferralsPort {
  readonly kind: "demo" | "server";
  dashboard(): Promise<ReferralDashboard>;
  rewards(): Promise<ReferralReward[]>;
  /** Só na demonstração: o negócio indicado ganha uso real e o worker avalia (concede no máximo uma vez). */
  simulateActivity?(): Promise<{ rewarded: number }>;
}
