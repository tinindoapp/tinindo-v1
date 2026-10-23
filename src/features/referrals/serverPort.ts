// Portas reais de Indicações: Edge Function `referrals` (leituras do dono).
import { ReferralDashboardOutput, ReferralRewardsListOutput } from "@contracts";
import type { createApiClient } from "../../lib/api/client.ts";
import type { ReferralsPort } from "./port.ts";

type Call = ReturnType<typeof createApiClient>;

export function createServerPort(call: Call, tenantId: string): ReferralsPort {
  const post = { method: "POST" as const, tenantId, body: {} };
  return {
    kind: "server",
    async dashboard() {
      return (await call("/referrals/referrals.dashboard", ReferralDashboardOutput, post)).data;
    },
    async rewards() {
      return (await call("/referrals/referrals.rewards", ReferralRewardsListOutput, post)).data.rewards;
    },
  };
}
