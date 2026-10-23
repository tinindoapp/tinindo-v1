// Portas reais de Campanhas: Edge Function `campaigns` (+ `crm` para os serviços da oferta).
import { CampaignGetOutput, CampaignListOutput, CampaignOutput, CampaignPreviewOutput, CRM_ROUTES, ServiceListOutput } from "@contracts";
import type { createApiClient } from "../../lib/api/client.ts";
import type { CampaignsPort } from "./port.ts";

type Call = ReturnType<typeof createApiClient>;
const op = (name: string) => `/campaigns/${name}`;

export function createServerPort(call: Call, tenantId: string): CampaignsPort {
  const post = (body: unknown, idempotencyKey?: string) => ({ method: "POST" as const, tenantId, body, idempotencyKey });
  return {
    kind: "server",
    async services() {
      return (await call(`/crm/${CRM_ROUTES.listServices}?limit=100`, ServiceListOutput, { tenantId })).data.items.map((s) => ({ id: s.id, name: s.name }));
    },
    async preview(segment) {
      return (await call(op("campaign.preview"), CampaignPreviewOutput, post({ segment }))).data;
    },
    async approve(input, key) {
      return (await call(op("campaign.approve"), CampaignOutput, post(input, key))).data.campaign;
    },
    async list() {
      return (await call(op("campaign.list"), CampaignListOutput, post({}))).data.campaigns;
    },
    async get(campaign_id) {
      return (await call(op("campaign.get"), CampaignGetOutput, post({ campaign_id }))).data;
    },
    async cancel(c, key) {
      return (await call(op("campaign.cancel"), CampaignOutput, post({ campaign_id: c.id, expected_version: c.version }, key))).data.campaign;
    },
  };
}
