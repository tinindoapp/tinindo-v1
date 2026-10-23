// Edge Function `lifecycle` (P13): réguas de relacionamento. Cada operação é uma RPC transacional do dono
// (ver _shared/http/rpc-handler.ts). O envio em si acontece no worker (`jobs`), nunca aqui.
import {
  LifecycleAudienceInput,
  LifecycleAudienceOutput,
  LifecycleCampaignApproveInput,
  LifecycleCampaignListInput,
  LifecycleCampaignListOutput,
  LifecycleCampaignOutput,
  LifecycleConsentOutput,
  LifecycleConsentSetInput,
  LifecycleSettingsGetInput,
  LifecycleSettingsOutput,
  LifecycleSettingsSaveInput,
  LifecycleStepOutput,
  LifecycleStepRefInput,
  LifecycleStepsListInput,
  LifecycleStepsListOutput,
} from "../_shared/contracts/index.ts";
import { createRpcHandler, type Route, route, type RpcHandlerDeps } from "../_shared/http/rpc-handler.ts";

export type LifecycleDeps = RpcHandlerDeps;

export const LIFECYCLE_ROUTES: Record<string, Route> = {
  "lifecycle.settings_get": route({ rpc: "lifecycle_settings_get", input: LifecycleSettingsGetInput, output: LifecycleSettingsOutput, command: false, args: () => ({}) }),
  "lifecycle.settings_save": route({
    rpc: "lifecycle_settings_save", input: LifecycleSettingsSaveInput, output: LifecycleSettingsOutput, command: true,
    args: (i) => ({ p_settings: i.settings, p_expected_version: i.expected_version }),
  }),
  "lifecycle.steps": route({ rpc: "lifecycle_steps_list", input: LifecycleStepsListInput, output: LifecycleStepsListOutput, command: false, args: (i) => ({ p_status: i.status }) }),
  "lifecycle.step_mark_shared": route({ rpc: "lifecycle_step_mark_shared", input: LifecycleStepRefInput, output: LifecycleStepOutput, command: true, args: (i) => ({ p_step_id: i.step_id }) }),
  "lifecycle.step_cancel": route({ rpc: "lifecycle_step_cancel", input: LifecycleStepRefInput, output: LifecycleStepOutput, command: true, args: (i) => ({ p_step_id: i.step_id }) }),
  "lifecycle.consent_set": route({
    rpc: "lifecycle_consent_set", input: LifecycleConsentSetInput, output: LifecycleConsentOutput, command: true,
    args: (i) => ({ p_customer_id: i.customer_id, p_purpose: i.purpose, p_granted: i.granted }),
  }),
  "lifecycle.audience": route({ rpc: "lifecycle_audience_preview", input: LifecycleAudienceInput, output: LifecycleAudienceOutput, command: false, args: () => ({}) }),
  "lifecycle.campaign_approve": route({
    rpc: "lifecycle_campaign_approve", input: LifecycleCampaignApproveInput, output: LifecycleCampaignOutput, command: true,
    args: (i) => ({ p_audience_hash: i.audience_hash, p_max_sends: i.max_sends }),
  }),
  "lifecycle.campaigns": route({ rpc: "lifecycle_campaign_list", input: LifecycleCampaignListInput, output: LifecycleCampaignListOutput, command: false, args: () => ({}) }),
};

export function createLifecycleHandler(deps: LifecycleDeps) {
  return createRpcHandler("lifecycle", LIFECYCLE_ROUTES, deps);
}
