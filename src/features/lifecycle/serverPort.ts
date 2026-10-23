// Portas reais do Relacionamento: Edge Function `lifecycle`. O envio é do worker (cron), não da tela.
import {
  LifecycleAudienceOutput,
  LifecycleCampaignListOutput,
  LifecycleCampaignOutput,
  LifecycleConsentOutput,
  LifecycleSettingsOutput,
  LifecycleStepOutput,
  LifecycleStepsListOutput,
} from "@contracts";
import type { createApiClient } from "../../lib/api/client.ts";
import type { LifecyclePort } from "./port.ts";

type Call = ReturnType<typeof createApiClient>;
const op = (name: string) => `/lifecycle/${name}`;

export function createServerPort(call: Call, tenantId: string): LifecyclePort {
  const post = (body: unknown, idempotencyKey?: string) => ({ method: "POST" as const, tenantId, body, idempotencyKey });
  return {
    kind: "server",
    async settings() {
      return (await call(op("lifecycle.settings_get"), LifecycleSettingsOutput, post({}))).data;
    },
    async saveSettings(settings, expected_version, key) {
      return (await call(op("lifecycle.settings_save"), LifecycleSettingsOutput, post({ settings, expected_version }, key))).data;
    },
    async steps(status) {
      return (await call(op("lifecycle.steps"), LifecycleStepsListOutput, post({ status }))).data;
    },
    async markShared(step_id, key) {
      return (await call(op("lifecycle.step_mark_shared"), LifecycleStepOutput, post({ step_id }, key))).data.step;
    },
    async cancelStep(step_id, key) {
      return (await call(op("lifecycle.step_cancel"), LifecycleStepOutput, post({ step_id }, key))).data.step;
    },
    async setConsent(customer_id, purpose, granted, key) {
      return (await call(op("lifecycle.consent_set"), LifecycleConsentOutput, post({ customer_id, purpose, granted }, key))).data.granted;
    },
    async audience() {
      return (await call(op("lifecycle.audience"), LifecycleAudienceOutput, post({}))).data;
    },
    async approveCampaign(audience_hash, max_sends, key) {
      return (await call(op("lifecycle.campaign_approve"), LifecycleCampaignOutput, post({ audience_hash, max_sends }, key))).data.campaign;
    },
    async campaigns() {
      return (await call(op("lifecycle.campaigns"), LifecycleCampaignListOutput, post({}))).data.campaigns;
    },
  };
}
