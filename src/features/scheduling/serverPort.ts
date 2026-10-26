// Implementação real da porta: Edge Functions por módulo (ADR-0002), envelope v1 validado.
// Agenda e expediente: `scheduling` (P03). Serviços e clientes: `crm` (P02).
// Cotação: `pricing` (P05). A cotação não segura horário; a reserva valida e consome a cotação no banco.
import {
  AvailabilityListOutput,
  BookingListOutput,
  BookingOutput,
  ContextResponse,
  CRM_ROUTES,
  CustomerListOutput,
  PublicContactOutput,
  Quote,
  ScheduleBlockOutput,
  ScheduleDayPlansOutput,
  ScheduleSettings,
  ServiceListOutput,
} from "@contracts";
import type { z } from "zod";
import { ApiError, type createApiClient } from "../../lib/api/client.ts";
import type { CustomerRef, SchedulingPort } from "./port.ts";

type Call = ReturnType<typeof createApiClient>;

/** Teto de páginas por leitura de lista (100 itens cada): protege a tela de laço infinito. */
const MAX_PAGES = 10;

export function createServerPort(call: Call, tenantId: string): SchedulingPort {
  const post = (body: unknown, idempotencyKey?: string) => ({
    method: "POST" as const,
    tenantId,
    body,
    idempotencyKey,
  });
  const scheduling = (op: string) => `/scheduling/${op}`;

  async function settings() {
    const { data } = await call(scheduling("schedule.settings"), ScheduleSettings, post({}));
    return data;
  }

  return {
    kind: "server",
    now: () => new Date(),
    async context() {
      const [ctx, s] = await Promise.all([call("/context", ContextResponse, { tenantId }), settings()]);
      return { tenantId: ctx.data.tenant_id, tenantName: ctx.data.tenant_name, timezone: s.timezone, resourceId: s.resource_id };
    },
    async listServices() {
      const { data } = await call(`/crm/${CRM_ROUTES.listServices}?limit=100`, ServiceListOutput, { tenantId });
      return data.items;
    },
    async listCustomers() {
      const out: CustomerRef[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < MAX_PAGES; page++) {
        const qs: string = new URLSearchParams({ limit: "100", ...(cursor ? { cursor } : {}) }).toString();
        const { data }: { data: z.infer<typeof CustomerListOutput> } = await call(
          `/crm/${CRM_ROUTES.listCustomers}?${qs}`, CustomerListOutput, { tenantId },
        );
        out.push(...data.items.map((c) => ({ id: c.id, name: c.name })));
        cursor = data.next_cursor;
        if (!cursor) break;
      }
      return out;
    },
    async listBookings(window) {
      const out = [];
      let cursor: string | undefined;
      for (let page = 0; page < MAX_PAGES; page++) {
        const { data } = await call(scheduling("booking.list"), BookingListOutput, post({ window, cursor, limit: 100 }));
        out.push(...data.bookings);
        if (!data.next_cursor) break;
        cursor = data.next_cursor;
      }
      return out;
    },
    async publicContact(bookingId) {
      try {
        const { data } = await call("/network/public.contact", PublicContactOutput, post({ booking_id: bookingId }));
        return { name: data.name, phone_e164: data.phone_e164 };
      } catch (err) {
        // Atendimento sem pedido pelo link: nada a mostrar.
        if (err instanceof ApiError && err.code === "NOT_FOUND") return null;
        throw err;
      }
    },
    async getBooking(id) {
      const { data } = await call(scheduling("booking.get"), BookingOutput, post({ booking_id: id }));
      return data.booking;
    },
    async dayPlans(window) {
      const { data } = await call(scheduling("schedule.day_plans"), ScheduleDayPlansOutput, post({ window }));
      return data.days;
    },
    async availability(input) {
      const { data } = await call(scheduling("availability.list"), AvailabilityListOutput, post(input));
      return data;
    },
    async quote(input) {
      const { data } = await call("/pricing/pricing.quote", Quote, post(input));
      return data;
    },
    async create(input, key) {
      const { data } = await call(scheduling("booking.create"), BookingOutput, post(input, key));
      return data.booking;
    },
    async reschedule(input, key) {
      const { data } = await call(scheduling("booking.reschedule"), BookingOutput, post(input, key));
      return data.booking;
    },
    async cancel(input, key) {
      const { data } = await call(scheduling("booking.cancel"), BookingOutput, post(input, key));
      return data.booking;
    },
    async complete(input, key) {
      const { data } = await call(scheduling("booking.complete"), BookingOutput, post(input, key));
      return data.booking;
    },
    settings,
    async saveRules(input, key) {
      const { data } = await call(scheduling("schedule.rules_save"), ScheduleSettings, post(input, key));
      return data;
    },
    async createBlock(input, key) {
      await call(scheduling("schedule.block_create"), ScheduleBlockOutput, post(input, key));
    },
    async removeBlock(input, key) {
      await call(scheduling("schedule.block_remove"), ScheduleBlockOutput, post(input, key));
    },
  };
}
