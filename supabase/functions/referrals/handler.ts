// Edge Function `referrals` (P21): painel de indicações de colegas. Leituras do dono pelo rpc-handler.
// O convite em si é criado pelo P09 (`network`); a elegibilidade e o benefício são decididos no worker (`jobs`).
import { ReferralDashboardInput, ReferralDashboardOutput, ReferralRewardsListInput, ReferralRewardsListOutput } from "../_shared/contracts/index.ts";
import { createRpcHandler, type Route, route, type RpcHandlerDeps } from "../_shared/http/rpc-handler.ts";

export type ReferralsDeps = RpcHandlerDeps;

export const REFERRALS_ROUTES: Record<string, Route> = {
  "referrals.dashboard": route({ rpc: "referral_dashboard", input: ReferralDashboardInput, output: ReferralDashboardOutput, command: false, args: () => ({}) }),
  "referrals.rewards": route({ rpc: "referral_rewards_list", input: ReferralRewardsListInput, output: ReferralRewardsListOutput, command: false, args: () => ({}) }),
};

export function createReferralsHandler(deps: ReferralsDeps) {
  return createRpcHandler("referrals", REFERRALS_ROUTES, deps);
}
