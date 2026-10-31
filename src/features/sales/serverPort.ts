// Portas reais dos Orçamentos: Edge Function `sales` e leituras de `context` e `crm`.
import {
  ContextResponse,
  CRM_ROUTES,
  CustomerListOutput,
  MaterialQuoteCostOutput,
  SalesQuoteDecideOutput,
  SalesQuoteDetailOutput,
  SalesQuoteListOutput,
  SalesQuoteOutput,
  SalesQuotePublicView,
  SalesQuoteSendOutput,
  ServiceListOutput,
} from "@contracts";
import type { z } from "zod";
import type { createApiClient } from "../../lib/api/client.ts";
import type { QuoteLinkPort, SalesPort } from "./port.ts";

type Call = ReturnType<typeof createApiClient>;

export function createServerPort(call: Call, tenantId: string): SalesPort {
  const post = (body: unknown, idempotencyKey?: string) => ({ method: "POST" as const, tenantId, body, idempotencyKey });
  const op = (name: string) => `/sales/${name}`;
  return {
    kind: "server",
    now: () => new Date(),
    async base() {
      const [ctx, services] = await Promise.all([
        call("/context", ContextResponse, { tenantId }),
        call(`/crm/${CRM_ROUTES.listServices}?limit=100`, ServiceListOutput, { tenantId }),
      ]);
      const customers: { id: string; name: string }[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < 10; page++) {
        const qs: string = new URLSearchParams({ limit: "100", ...(cursor ? { cursor } : {}) }).toString();
        const { data }: { data: z.infer<typeof CustomerListOutput> } = await call(`/crm/${CRM_ROUTES.listCustomers}?${qs}`, CustomerListOutput, { tenantId });
        customers.push(...data.items.map((c) => ({ id: c.id, name: c.name })));
        cursor = data.next_cursor;
        if (!cursor) break;
      }
      return {
        timezone: ctx.data.timezone,
        customers,
        services: services.data.items.filter((s) => s.active).map((s) => ({ id: s.id, name: s.name, duration_min: s.duration_min,
          base_price_cents: s.base_price_cents })),
      };
    },
    async list() {
      return (await call(op("quote.list"), SalesQuoteListOutput, post({}))).data.quotes;
    },
    async get(quoteId) {
      return (await call(op("quote.get"), SalesQuoteDetailOutput, post({ quote_id: quoteId }))).data;
    },
    async materialCost(quoteId) {
      return (await call("/materials/materials.quote_cost", MaterialQuoteCostOutput, post({ quote_id: quoteId }))).data;
    },
    async create(d, key) {
      return (await call(op("quote.create"), SalesQuoteOutput, post(d, key))).data.quote;
    },
    async revise(q, d, key) {
      const { customer_id: _ignored, ...content } = d;
      return (await call(op("quote.revise"), SalesQuoteOutput, post({ quote_id: q.id, expected_version: q.current_version, ...content }, key))).data.quote;
    },
    async send(q, key) {
      return (await call(op("quote.send"), SalesQuoteSendOutput, post({ quote_id: q.id, expected_version: q.current_version }, key))).data;
    },
    async cancel(quoteId, key) {
      return (await call(op("quote.cancel"), SalesQuoteOutput, post({ quote_id: quoteId }, key))).data.quote;
    },
  };
}

/** Link do orçamento: sem login e sem tenant; o token vai só no corpo do POST. */
export function createServerLinkPort(call: Call): QuoteLinkPort {
  const post = (body: unknown, idempotencyKey?: string) => ({ method: "POST" as const, body, idempotencyKey });
  const decide = (token: string, v: { version_no: number; snapshot_hash: string }) => ({ token, version_no: v.version_no, snapshot_hash: v.snapshot_hash });
  return {
    kind: "server",
    async view(token) {
      return (await call("/sales/quote.view", SalesQuotePublicView, post({ token }))).data;
    },
    async accept(token, view, key) {
      return (await call("/sales/quote.accept", SalesQuoteDecideOutput, post(decide(token, view), key))).data;
    },
    async decline(token, view, key) {
      return (await call("/sales/quote.decline", SalesQuoteDecideOutput, post(decide(token, view), key))).data;
    },
  };
}
