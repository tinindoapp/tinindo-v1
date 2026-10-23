// Portas reais de Assinaturas: Edge Function `recurrence` (+ `crm` para clientes e serviços, `context` para o fuso).
import {
  ContextResponse,
  CRM_ROUTES,
  CustomerListOutput,
  RecurrenceCyclesOutput,
  RecurrenceListOutput,
  RecurrencePlanListOutput,
  RecurrencePlanOutput,
  RecurrenceSubscriptionOutput,
  ServiceListOutput,
} from "@contracts";
import type { z } from "zod";
import type { createApiClient } from "../../lib/api/client.ts";
import type { RecurrencePort } from "./port.ts";

type Call = ReturnType<typeof createApiClient>;
const op = (name: string) => `/recurrence/${name}`;
const MAX_PAGES = 10;

export function createServerPort(call: Call, tenantId: string): RecurrencePort {
  const post = (body: unknown, idempotencyKey?: string) => ({ method: "POST" as const, tenantId, body, idempotencyKey });
  return {
    kind: "server",
    async base() {
      const ctx = await call("/context", ContextResponse, { tenantId });
      const services = await call(`/crm/${CRM_ROUTES.listServices}?limit=100`, ServiceListOutput, { tenantId });
      const customers: { id: string; name: string }[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < MAX_PAGES; page++) {
        const qs: string = new URLSearchParams({ limit: "100", ...(cursor ? { cursor } : {}) }).toString();
        const { data }: { data: z.infer<typeof CustomerListOutput> } = await call(`/crm/${CRM_ROUTES.listCustomers}?${qs}`, CustomerListOutput, { tenantId });
        customers.push(...data.items.map((c) => ({ id: c.id, name: c.name })));
        cursor = data.next_cursor;
        if (!cursor) break;
      }
      return { timezone: ctx.data.timezone, customers, services: services.data.items };
    },
    async plans() {
      return (await call(op("recurrence.plans"), RecurrencePlanListOutput, post({}))).data.plans;
    },
    async savePlan(input, key) {
      return (await call(op("recurrence.plan_save"), RecurrencePlanOutput, post(input, key))).data.plan;
    },
    async subscriptions() {
      return (await call(op("recurrence.subscriptions"), RecurrenceListOutput, post({}))).data.subscriptions;
    },
    async subscribe(plan_id, customer_id, key) {
      return (await call(op("recurrence.subscribe"), RecurrenceSubscriptionOutput, post({ plan_id, customer_id }, key))).data.subscription;
    },
    async cancel(sub, at_period_end, reason, key) {
      return (await call(op("recurrence.cancel"), RecurrenceSubscriptionOutput, post({ subscription_id: sub.id, expected_version: sub.version, at_period_end, reason }, key))).data.subscription;
    },
    async resume(sub, key) {
      return (await call(op("recurrence.resume"), RecurrenceSubscriptionOutput, post({ subscription_id: sub.id, expected_version: sub.version }, key))).data.subscription;
    },
    async cycles(subscription_id) {
      return (await call(op("recurrence.cycles"), RecurrenceCyclesOutput, post({ subscription_id }))).data.cycles;
    },
  };
}
