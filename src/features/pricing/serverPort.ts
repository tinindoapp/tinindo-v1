// Porta real de Preços: Edge Function `pricing` (P05) e catálogo do `crm` (P02), envelope v1 validado.
import {
  ActionApproval,
  ContextResponse,
  CRM_ROUTES,
  PricingListRulesOutput,
  PricingRuleOutput,
  PricingRuleProposal,
  ServiceListOutput,
} from "@contracts";
import type { createApiClient } from "../../lib/api/client.ts";
import type { PricingPort } from "./port.ts";

type Call = ReturnType<typeof createApiClient>;
/** Até 1.000 serviços (10 páginas de 100), como as outras portas que paginam o catálogo (recado #169, item 4). */
const MAX_PAGES = 10;

export function createServerPort(call: Call, tenantId: string): PricingPort {
  const post = (body: unknown, idempotencyKey?: string) => ({ method: "POST" as const, tenantId, body, idempotencyKey });
  const op = (name: string) => `/pricing/${name}`;
  return {
    kind: "server",
    now: () => new Date(),
    async timezone() {
      return (await call("/context", ContextResponse, { tenantId })).data.timezone;
    },
    async services() {
      const items: ServiceListOutput["items"] = [];
      let cursor: string | null = null;
      for (let page = 0; page < MAX_PAGES; page++) {
        const qs: string = new URLSearchParams({ limit: "100", ...(cursor ? { cursor } : {}) }).toString();
        const { data }: { data: ServiceListOutput } = await call(`/crm/${CRM_ROUTES.listServices}?${qs}`, ServiceListOutput, { tenantId });
        items.push(...data.items);
        cursor = data.next_cursor;
        if (!cursor) break;
      }
      return items;
    },
    async list() {
      return (await call(op("pricing.list_rules"), PricingListRulesOutput, post({}))).data;
    },
    async propose(input, key) {
      return (await call(op("pricing.propose_rule"), PricingRuleProposal, post(input, key))).data;
    },
    async approve(input, key) {
      return (await call(op("pricing.approve_rule"), ActionApproval, post(input, key))).data;
    },
    async publish(input, key) {
      return (await call(op("pricing.publish_rule"), PricingRuleOutput, post(input, key))).data.rule;
    },
    async deactivate(input, key) {
      return (await call(op("pricing.deactivate_rule"), PricingRuleOutput, post(input, key))).data.rule;
    },
  };
}
