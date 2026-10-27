// Portas reais da Equipe: Edge Function `resources` (+ `crm` para clientes e serviços, `context` para o fuso).
import {
  ContextResponse,
  CRM_ROUTES,
  CustomerListOutput,
  ServiceListOutput,
  TeamAvailabilityOutput,
  TeamBookingOutput,
  TeamClassOutput,
  TeamCommissionEntryOutput,
  TeamCommissionRulesOutput,
  TeamCommissionsOutput,
  TeamListOutput,
  TeamResourceOutput,
  TeamScheduleOutput,
} from "@contracts";
import type { z } from "zod";
import type { createApiClient } from "../../lib/api/client.ts";
import type { ResourcesPort } from "./port.ts";

type Call = ReturnType<typeof createApiClient>;
const op = (name: string) => `/resources/${name}`;
const MAX_PAGES = 10;

export function createServerPort(call: Call, tenantId: string): ResourcesPort {
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
      return { timezone: ctx.data.timezone, customers, services: services.data.items.filter((s) => s.active), now: new Date().toISOString() };
    },
    async list() {
      const { data } = await call(op("resources.list"), TeamListOutput, post({}));
      return { resources: data.resources, commission_rules: data.commission_rules };
    },
    async save(input, key) {
      return (await call(op("resources.save"), TeamResourceOutput, post(input, key))).data.resource;
    },
    async saveRule(professional_id, service_id, bps, key) {
      return (await call(op("resources.commission_rule_save"), TeamCommissionRulesOutput, post({ professional_id, service_id, bps }, key))).data.commission_rules;
    },
    async availability(service_id, professional_id, resource_ids, window) {
      return (await call(op("resources.availability"), TeamAvailabilityOutput, post({ service_id, professional_id, resource_ids, window }))).data.slots;
    },
    async book(input, key) {
      return (await call(op("resources.booking_create"), TeamBookingOutput, post(input, key))).data.booking;
    },
    async cancelBooking(b, reason, key) {
      return (await call(op("resources.booking_cancel"), TeamBookingOutput, post({ booking_id: b.id, expected_version: b.version, reason }, key))).data.booking;
    },
    async completeBooking(b, key) {
      return (await call(op("resources.booking_complete"), TeamBookingOutput, post({ booking_id: b.id, expected_version: b.version }, key))).data.booking;
    },
    async schedule(window) {
      return (await call(op("resources.schedule"), TeamScheduleOutput, post({ window }))).data;
    },
    async createClass(input, key) {
      return (await call(op("resources.class_create"), TeamClassOutput, post(input, key))).data.class;
    },
    async enroll(class_id, customer_id, key) {
      return (await call(op("resources.class_enroll"), TeamClassOutput, post({ class_id, customer_id }, key))).data.class;
    },
    async cancelSeat(seat_id, expected_version, key) {
      return (await call(op("resources.class_seat_cancel"), TeamClassOutput, post({ seat_id, expected_version }, key))).data.class;
    },
    async cancelClass(c, key) {
      return (await call(op("resources.class_cancel"), TeamClassOutput, post({ class_id: c.id, expected_version: c.version }, key))).data.class;
    },
    async completeClass(c, attended_seat_ids, key) {
      return (await call(op("resources.class_complete"), TeamClassOutput, post({ class_id: c.id, expected_version: c.version, attended_seat_ids }, key))).data.class;
    },
    async commissions(period) {
      return (await call(op("resources.commissions"), TeamCommissionsOutput, post({ period }))).data;
    },
    async reverseCommission(entry_id, key) {
      return (await call(op("resources.commission_reverse"), TeamCommissionEntryOutput, post({ entry_id }, key))).data.entry;
    },
  };
}
