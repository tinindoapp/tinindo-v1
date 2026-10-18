// Portas reais da Lista de espera: Edge Function `waitlist` e leituras de `crm`, `scheduling` e `pricing`.
import {
  BookingOutput,
  ContactConsent,
  ContextResponse,
  CRM_ROUTES,
  CustomerListOutput,
  Quote,
  ScheduleSettings,
  ServiceListOutput,
  WaitlistDeclineOutput,
  WaitlistEntry,
  WaitlistListOutput,
  WaitlistOffer,
  WaitlistOfferView,
} from "@contracts";
import type { z } from "zod";
import type { createApiClient } from "../../lib/api/client.ts";
import type { OfferLinkPort, WaitlistPort } from "./port.ts";

type Call = ReturnType<typeof createApiClient>;

export function createServerPort(call: Call, tenantId: string): WaitlistPort {
  const post = (body: unknown, idempotencyKey?: string) => ({ method: "POST" as const, tenantId, body, idempotencyKey });
  const wl = (op: string) => `/waitlist/${op}`;
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
      return { timezone: ctx.data.timezone, customers, services: services.data.items.map((s) => ({ id: s.id, name: s.name, duration_min: s.duration_min })) };
    },
    async list() {
      return (await call(wl("waitlist.list"), WaitlistListOutput, post({}))).data;
    },
    async join(input, key) {
      const consent = await call(wl("consent.record"), ContactConsent,
        post({ customer_id: input.customer_id, purpose: "waitlist_offer", channel: "manual_share" }, `${key}-consent`));
      const entry = await call(wl("waitlist.join"), WaitlistEntry, post({
        customer_id: input.customer_id, service_id: input.service_id, acceptable_windows: input.windows,
        consent_id: consent.data.consent_id, valid_until: input.valid_until,
      }, key));
      return entry.data;
    },
    async withdraw(entry, key) {
      await call(wl("waitlist.withdraw"), WaitlistEntry, post({ entry_id: entry.id, expected_version: entry.version ?? 1 }, key));
    },
    async prepareOffer(entry, slot, key) {
      const settings = await call("/scheduling/schedule.settings", ScheduleSettings, post({}));
      const quote = await call("/pricing/pricing.quote", Quote, post({ service_id: entry.service_id, resource_id: settings.data.resource_id, slot }));
      return (await call(wl("waitlist.prepare_offer"), WaitlistOffer, post({ entry_id: entry.id, slot, quote_id: quote.data.quote_id }, key))).data;
    },
    async markShared(offerId, key) {
      await call(wl("waitlist.mark_shared"), WaitlistOffer, post({ offer_id: offerId }, key));
    },
    async cancelOffer(offerId, key) {
      await call(wl("waitlist.cancel_offer"), WaitlistOffer, post({ offer_id: offerId }, key));
    },
  };
}

/** Link da oferta: sem login e sem tenant; o token vai só no corpo do POST. */
export function createServerLinkPort(call: Call): OfferLinkPort {
  const post = (body: unknown, idempotencyKey?: string) => ({ method: "POST" as const, body, idempotencyKey });
  return {
    kind: "server",
    async view(token) {
      return (await call("/waitlist/waitlist.offer_view", WaitlistOfferView, post({ token }))).data;
    },
    async accept(token, key) {
      return (await call("/waitlist/waitlist.accept_offer", BookingOutput, post({ token }, key))).data.booking;
    },
    async decline(token, key) {
      await call("/waitlist/waitlist.decline_offer", WaitlistDeclineOutput, post({ token }, key));
    },
  };
}
