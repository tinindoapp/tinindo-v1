// Portas reais de Materiais: Edge Function `materials` (+ `crm` para serviços, `context` para o fuso).
import {
  ContextResponse,
  CRM_ROUTES,
  MaterialBookingsOutput,
  MaterialConsumptionOutput,
  MaterialItemOutput,
  MaterialListOutput,
  MaterialMarginOutput,
  MaterialMovementsOutput,
  MaterialPurchaseOutput,
  MaterialUsageOutput,
  ServiceListOutput,
} from "@contracts";
import type { createApiClient } from "../../lib/api/client.ts";
import type { MaterialsPort } from "./port.ts";

type Call = ReturnType<typeof createApiClient>;
const op = (name: string) => `/materials/${name}`;

export function createServerPort(call: Call, tenantId: string): MaterialsPort {
  const post = (body: unknown, idempotencyKey?: string) => ({ method: "POST" as const, tenantId, body, idempotencyKey });
  return {
    kind: "server",
    async base() {
      const ctx = await call("/context", ContextResponse, { tenantId });
      const services = await call(`/crm/${CRM_ROUTES.listServices}?limit=100`, ServiceListOutput, { tenantId });
      return { timezone: ctx.data.timezone, services: services.data.items, now: new Date().toISOString() };
    },
    async list() {
      const { data } = await call(op("materials.list"), MaterialListOutput, post({}));
      return { items: data.items, usage: data.usage };
    },
    async saveItem(input, key) {
      return (await call(op("materials.item_save"), MaterialItemOutput, post(input, key))).data.item;
    },
    async saveUsage(service_id, item_id, quantity, key) {
      return (await call(op("materials.usage_save"), MaterialUsageOutput, post({ service_id, item_id, quantity }, key))).data.usage;
    },
    async purchase(supplier, purchased_at, lines, record_expense, key) {
      return (await call(op("materials.purchase"), MaterialPurchaseOutput, post({ supplier, purchased_at, lines, record_expense }, key))).data.purchase;
    },
    async reversePurchase(p, key) {
      return (await call(op("materials.purchase_reverse"), MaterialPurchaseOutput, post({ purchase_id: p.id, expected_version: p.version }, key))).data.purchase;
    },
    async adjust(item, counted, reason, key) {
      return (await call(op("materials.adjust"), MaterialItemOutput, post({ item_id: item.id, expected_version: item.version, counted, reason }, key))).data.item;
    },
    async consume(booking_id, lines, key) {
      return (await call(op("materials.consume"), MaterialConsumptionOutput, post({ booking_id, lines }, key))).data.consumption;
    },
    async reverseConsumption(c, key) {
      return (await call(op("materials.consume_reverse"), MaterialConsumptionOutput, post({ consumption_id: c.id, expected_version: c.version }, key))).data.consumption;
    },
    async purchases(period) {
      return (await call(op("materials.movements"), MaterialMovementsOutput, post({ item_id: null, period }))).data.purchases;
    },
    async bookings(period) {
      return (await call(op("materials.bookings"), MaterialBookingsOutput, post({ period }))).data.bookings;
    },
    async margin(period) {
      const { data } = await call(op("materials.margin"), MaterialMarginOutput, post({ period }));
      return { services: data.services, totals: data.totals };
    },
  };
}
