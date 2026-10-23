// Edge Function `campaigns` (P19): campanhas com público autorizado, limites no servidor, controle sorteado e
// resultado com intervalo. Dono pelo rpc-handler; o envio é do P13/P12 e o fechamento do worker `jobs`.
import {
  CampaignApproveInput, CampaignCancelInput, CampaignGetInput, CampaignGetOutput, CampaignListInput, CampaignListOutput, CampaignOutput,
  CampaignPreviewInput, CampaignPreviewOutput,
} from "../_shared/contracts/index.ts";
import { createRpcHandler, type Route, route, type RpcHandlerDeps } from "../_shared/http/rpc-handler.ts";

export type CampaignsDeps = RpcHandlerDeps;

export const CAMPAIGNS_ROUTES: Record<string, Route> = {
  "campaign.preview": route({ rpc: "campaign_preview", input: CampaignPreviewInput, output: CampaignPreviewOutput, command: false, args: (i) => ({ p_segment: i.segment }) }),
  "campaign.approve": route({
    rpc: "campaign_approve", input: CampaignApproveInput, output: CampaignOutput, command: true,
    args: (i) => ({ p_name: i.name, p_segment: i.segment, p_audience_hash: i.audience_hash, p_control_pct: i.control_pct, p_max_sends: i.max_sends,
      p_spend_cap_cents: i.spend_cap_cents, p_window_days: i.window_days, p_offer: i.offer }),
  }),
  "campaign.list": route({ rpc: "campaign_list", input: CampaignListInput, output: CampaignListOutput, command: false, args: () => ({}) }),
  "campaign.get": route({ rpc: "campaign_get", input: CampaignGetInput, output: CampaignGetOutput, command: false, args: (i) => ({ p_campaign_id: i.campaign_id }) }),
  "campaign.cancel": route({
    rpc: "campaign_cancel", input: CampaignCancelInput, output: CampaignOutput, command: true,
    args: (i) => ({ p_campaign_id: i.campaign_id, p_expected_version: i.expected_version }),
  }),
};

export function createCampaignsHandler(deps: CampaignsDeps) {
  return createRpcHandler("campaigns", CAMPAIGNS_ROUTES, deps);
}
