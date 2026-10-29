// Acesso do módulo Perfil à Edge Function `network`. Duas implementações com a mesma interface:
// HTTP (servidor real) e demonstração offline (memória da aba, rotulada, nada é salvo).
import {
  AvailabilityListOutput,
  type ProfilePublishInput,
  type PublicBookInput,
  PublicBookOutput,
  type PublicConfirmInput,
  PublicConfirmOutput,
  PublicProfile,
  PublicServicesOutput,
  type ReferralCreateInput,
  ReferralLink,
} from "@contracts";
import { bookingsA, FIXED_NOW, services, tenantA } from "@contracts/fixtures.ts";
import type { z } from "zod";
import {
  type OwnerProfile,
  OwnerProfileOutput,
  ProfileUnpublishOutput,
  ReferralClaimOutput,
  type ReferralInspectOutput,
  ReferralInspectOutput as ReferralInspectSchema,
  ReferralListOutput,
  type ReferralSummary,
} from "@contracts";
import { ApiError, type CallOptions } from "../../lib/api/client.ts";
import { currentReviewSummary, providePublicContact, publicBooking, setPublishedSlug } from "../../lib/demo/journey.ts";
import { demoSlots } from "./demo-slots.ts";

export type PublicProfileData = z.infer<typeof PublicProfile>;
export type ReferralLinkData = z.infer<typeof ReferralLink>;
export type SlotsData = z.infer<typeof AvailabilityListOutput>;
export type { OwnerProfile, ReferralInspectOutput, ReferralSummary };

export interface PublicService {
  id: string;
  name: string;
  duration_min: number;
}

export type BookRequest = z.infer<typeof PublicBookOutput> & {
  /** Só na demonstração: o código que o canal enviaria (nada é enviado de verdade). */
  demoCode?: string;
};
export type BookConfirmed = z.infer<typeof PublicConfirmOutput>;

export interface NetworkApi {
  /** `true` quando os dados são de demonstração (sem servidor): a UI exibe o rótulo. */
  readonly demo: boolean;
  getOwnProfile(): Promise<OwnerProfile | null>;
  publishProfile(input: z.input<typeof ProfilePublishInput>, idempotencyKey: string): Promise<PublicProfileData>;
  unpublishProfile(idempotencyKey: string): Promise<void>;
  getPublicProfile(slug: string): Promise<PublicProfileData>;
  /** Serviços que o visitante pode escolher (nome e duração). Vazio se o perfil não mostra o link de reserva. */
  publicServices(slug: string): Promise<PublicService[]>;
  publicSlots(slug: string, serviceId: string, window: { starts_at: string; ends_at: string }): Promise<SlotsData>;
  /** Pede o horário: reserva provisória + código para o contato. Ainda não é confirmação. */
  book(input: z.input<typeof PublicBookInput>, idempotencyKey: string): Promise<BookRequest>;
  /** Confirma com o código recebido. */
  confirmBooking(input: z.input<typeof PublicConfirmInput>, idempotencyKey: string): Promise<BookConfirmed>;
  createReferral(input: z.input<typeof ReferralCreateInput>, idempotencyKey: string): Promise<ReferralLinkData>;
  listReferrals(): Promise<ReferralSummary[]>;
  inspectReferral(token: string): Promise<ReferralInspectOutput>;
  claimReferral(token: string, idempotencyKey: string): Promise<void>;
}

type Call = <T extends z.ZodType>(
  path: string,
  schema: T,
  opts?: CallOptions,
) => Promise<{ data: z.infer<T> }>;

export function createHttpNetworkApi(call: Call, tenantId: string | null): NetworkApi {
  const tenant = tenantId ?? undefined;
  return {
    demo: false,
    async getOwnProfile() {
      return (await call("/network/profile.get", OwnerProfileOutput, { tenantId: tenant })).data.profile;
    },
    async publishProfile(input, idempotencyKey) {
      return (await call("/network/profile.publish", PublicProfile, { method: "POST", tenantId: tenant, body: input, idempotencyKey })).data;
    },
    async unpublishProfile(idempotencyKey) {
      await call("/network/profile.unpublish", ProfileUnpublishOutput, { method: "POST", tenantId: tenant, body: {}, idempotencyKey });
    },
    async getPublicProfile(slug) {
      return (await call(`/network/public.profile?slug=${encodeURIComponent(slug)}`, PublicProfile)).data;
    },
    async publicServices(slug) {
      try {
        return (await call("/network/public.services", PublicServicesOutput, { method: "POST", body: { slug } })).data.services;
      } catch (e) {
        // Perfil sem o link de reserva: nada a escolher (a tela orienta a combinar direto).
        if (e instanceof ApiError && e.code === "NOT_FOUND") return [];
        throw e;
      }
    },
    async publicSlots(slug, serviceId, window) {
      return (await call("/network/public.slots", AvailabilityListOutput, { method: "POST", body: { slug, service_id: serviceId, window } })).data;
    },
    async book(input, idempotencyKey) {
      return (await call("/network/public.book", PublicBookOutput, { method: "POST", body: input, idempotencyKey })).data;
    },
    async confirmBooking(input, idempotencyKey) {
      return (await call("/network/public.confirm", PublicConfirmOutput, { method: "POST", body: input, idempotencyKey })).data;
    },
    async createReferral(input, idempotencyKey) {
      return (await call("/network/referral.create", ReferralLink, { method: "POST", tenantId: tenant, body: input, idempotencyKey })).data;
    },
    async listReferrals() {
      return (await call("/network/referral.list", ReferralListOutput)).data.referrals;
    },
    async inspectReferral(token) {
      return (await call("/network/referral.inspect", ReferralInspectSchema, { method: "POST", body: { token } })).data;
    },
    async claimReferral(token, idempotencyKey) {
      await call("/network/referral.claim", ReferralClaimOutput, { method: "POST", body: { token }, idempotencyKey });
    },
  };
}

// ---------------------------------------------------------------------------
// Demonstração offline: memória da aba, dados fictícios do tenant A das fixtures.
// ---------------------------------------------------------------------------

interface DemoReferral extends ReferralSummary {
  token: string;
}

/** Pedido do link na demonstração: mesmas regras do banco (prazo, 5 tentativas), código mostrado na tela. */
interface DemoBookRequest {
  request: BookRequest;
  bookingId: string;
  code: string;
  attempts: number;
  confirmed: BookConfirmed | null;
  hash: string;
  serviceName: string;
  contactName: string;
  contactPhone: string;
  /** Trocado por um pedido novo do mesmo contato: o código deixa de valer. */
  replaced: boolean;
}

interface DemoState {
  profile: OwnerProfile | null;
  referrals: DemoReferral[];
  requests: Map<string, DemoBookRequest>;
  /** Horários segurados quando a Agenda da demonstração não está carregada (testes do módulo). */
  localHolds: { starts_at: string; ends_at: string }[];
}

const demoState: DemoState = { profile: null, referrals: [], requests: new Map(), localHolds: [] };

// A Agenda da demonstração mostra ao dono quem pediu cada horário pelo link (como public.contact no servidor).
providePublicContact((bookingId) => {
  const r = [...demoState.requests.values()].find((x) => x.bookingId === bookingId);
  return r ? { name: r.contactName, phone_e164: r.contactPhone } : null;
});

/** Só para testes: volta a demonstração ao estado inicial. */
export function resetDemoNetwork() {
  demoState.profile = null;
  setPublishedSlug(null);
  demoState.referrals = [];
  demoState.requests.clear();
  demoState.localHolds = [];
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const notFound = () => new ApiError("NOT_FOUND", "Não encontrado.", 404, null, false);
const rejected = (field: string) => new ApiError("POLICY_REJECTED", "Não foi possível confirmar.", 422, null, false, field);
const overlaps = (a: { starts_at: string; ends_at: string }, b: { starts_at: string; ends_at: string }) =>
  Date.parse(a.starts_at) < Date.parse(b.ends_at) && Date.parse(b.starts_at) < Date.parse(a.ends_at);
/** Código de 6 dígitos sem viés: descarta sorteios acima do último múltiplo de 1.000.000 (como app.pbk_new_code). */
function demoCode(): string {
  const buf = new Uint32Array(1);
  do crypto.getRandomValues(buf);
  while (buf[0]! >= 4_294_000_000);
  return String(buf[0]! % 1_000_000).padStart(6, "0");
}

function toPublic(p: OwnerProfile): PublicProfileData {
  if (!p.published_at) throw notFound();
  // Mesmo resumo da lista pública de avaliações da demonstração (no servidor, vem da mesma função).
  const reputation = currentReviewSummary() ?? p.reputation;
  return { slug: p.slug, category: p.category, area: p.area, fields: p.fields, published_at: p.published_at, reputation };
}

export function createDemoNetworkApi(origin: string): NetworkApi {
  const now = () => new Date().toISOString();
  return {
    demo: true,
    async getOwnProfile() {
      return demoState.profile;
    },
    async publishProfile(input) {
      const fields: OwnerProfile["fields"] = {};
      for (const f of input.public_fields) {
        if (f === "display_name") fields.display_name = tenantA.name;
        if (f === "category") fields.category = input.category;
        if (f === "area") fields.area = input.area;
        if (f === "booking_link") fields.booking_link = `${origin}/p/${input.slug}`;
      }
      demoState.profile = {
        slug: input.slug,
        category: input.category,
        area: input.area.trim(),
        public_fields: [...new Set(input.public_fields)].sort(),
        fields,
        published_at: now(),
        reputation: { identity_verified: false, reviews_count: 0 },
        version: (demoState.profile?.version ?? 0) + 1,
      };
      setPublishedSlug(input.slug);
      return toPublic(demoState.profile);
    },
    async unpublishProfile() {
      if (!demoState.profile) throw notFound();
      demoState.profile = { ...demoState.profile, published_at: null, version: demoState.profile.version + 1 };
      setPublishedSlug(null);
    },
    async getPublicProfile(slug) {
      if (!demoState.profile || demoState.profile.slug !== slug) throw notFound();
      return toPublic(demoState.profile);
    },
    async publicServices(slug) {
      if (!demoState.profile || demoState.profile.slug !== slug) return [];
      return services
        .filter((s) => s.tenant_id === tenantA.id && s.active)
        .map((s) => ({ id: s.id, name: s.name, duration_min: s.duration_min }));
    },
    async publicSlots(_slug, serviceId, window) {
      const service = services.find((s) => s.id === serviceId);
      if (!service) throw notFound();
      // Com a Agenda da aba carregada, os horários são os dela (o que o dono e outros visitantes ocuparam some).
      const agenda = publicBooking();
      if (agenda) return { slots: await agenda.slots(serviceId, window), timezone: tenantA.timezone };
      const free = demoSlots(bookingsA, service, FIXED_NOW, window.starts_at.slice(0, 10)).filter((s) => !demoState.localHolds.some((h) => overlaps(h, s)));
      return { slots: free, timezone: tenantA.timezone };
    },
    async book(input, key) {
      if (!demoState.profile?.published_at || demoState.profile.slug !== input.slug) throw notFound();
      const hash = JSON.stringify({ ...input, replace_existing: undefined });
      const prior = demoState.requests.get(key);
      if (prior) {
        if (prior.hash !== hash) throw new ApiError("IDEMPOTENCY_MISMATCH", "Pedido diferente com a mesma chave.", 409, null, false);
        return prior.request;
      }
      const service = services.find((s) => s.id === input.service_id && s.tenant_id === tenantA.id);
      if (!service) throw notFound();
      const agenda = publicBooking();
      // Mesma regra do banco: o mesmo WhatsApp com pedido aguardando código só troca com replace_existing.
      const pending = [...demoState.requests.values()].find((r) => r.contactPhone === input.contact.phone_e164 && !r.confirmed && !r.replaced);
      if (pending && !input.replace_existing) {
        throw new ApiError("PENDING_REQUEST_EXISTS", "Você já tem um pedido aguardando confirmação.", 409, null, false, "contact.phone_e164", {
          request_id: pending.request.request_id, service_name: pending.serviceName,
          starts_at: pending.request.slot.starts_at, expires_at: pending.request.expires_at,
        });
      }
      if (pending) {
        if (agenda) await agenda.release(pending.bookingId);
        else demoState.localHolds = demoState.localHolds.filter((h) => h.starts_at !== pending.request.slot.starts_at);
        pending.replaced = true;
      }
      let hold: { booking_id: string; starts_at: string; ends_at: string; hold_expires_at: string };
      if (agenda) {
        hold = await agenda.hold({ service_id: service.id, starts_at: input.starts_at });
      } else {
        const slot = { starts_at: input.starts_at, ends_at: new Date(Date.parse(input.starts_at) + service.duration_min * 60_000).toISOString() };
        if (demoState.localHolds.some((h) => overlaps(h, slot))) throw new ApiError("SLOT_CONFLICT", "Este horário não está mais disponível.", 409, null, false, "slot");
        demoState.localHolds.push(slot);
        hold = { booking_id: crypto.randomUUID(), ...slot, hold_expires_at: new Date(Date.parse(FIXED_NOW) + 15 * 60_000).toISOString() };
      }
      const code = demoCode();
      const request: BookRequest = {
        request_id: crypto.randomUUID(),
        slot: { starts_at: hold.starts_at, ends_at: hold.ends_at },
        expires_at: hold.hold_expires_at,
        delivery: "queued",
        ...(pending ? { replaced: { service_name: pending.serviceName, starts_at: pending.request.slot.starts_at } } : {}),
        demoCode: code,
      };
      // Trocar não zera as tentativas de código já gastas no pedido anterior.
      demoState.requests.set(key, { request, bookingId: hold.booking_id, code, attempts: pending?.attempts ?? 0, confirmed: null, hash,
        serviceName: service.name, contactName: input.contact.name.trim(), contactPhone: input.contact.phone_e164, replaced: false });
      return request;
    },
    async confirmBooking(input) {
      const r = [...demoState.requests.values()].find((x) => x.request.request_id === input.request_id);
      if (!r) throw notFound();
      if (r.confirmed) return r.confirmed;
      if (r.replaced) throw rejected("expires_at");
      if (r.attempts >= 5) throw rejected("attempts");
      if (input.code !== r.code) {
        r.attempts += 1;
        throw rejected("code");
      }
      await publicBooking()?.confirm(r.bookingId);
      r.confirmed = { status: "confirmed", slot: r.request.slot, timezone: tenantA.timezone, service_name: r.serviceName };
      return r.confirmed;
    },
    async createReferral(input) {
      const token = randomToken();
      const created = now();
      const expires = new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString();
      const referral: DemoReferral = {
        referral_id: crypto.randomUUID(),
        kind: input.kind,
        invitee_name: input.invitee_name.trim(),
        invitee_category: input.invitee_category ?? null,
        state: "pending",
        created_at: created,
        expires_at: expires,
        token,
      };
      demoState.referrals.unshift(referral);
      return { referral_id: referral.referral_id, share_url: `${origin}/convite#t=${token}`, expires_at: expires };
    },
    async listReferrals() {
      return demoState.referrals.map(({ token: _token, ...summary }) => summary);
    },
    async inspectReferral(token) {
      const r = demoState.referrals.find((x) => x.token === token);
      if (!r) throw notFound();
      return {
        kind: r.kind,
        invitee_category: r.invitee_category,
        state: r.state === "claimed" ? "used" : "open",
        expires_at: r.expires_at,
        inviter_profile_slug: r.kind === "professional_invites_peer" && demoState.profile?.published_at ? demoState.profile.slug : null,
      };
    },
    async claimReferral(token) {
      const r = demoState.referrals.find((x) => x.token === token);
      if (!r) throw notFound();
      if (r.state === "claimed") throw new ApiError("POLICY_REJECTED", "Este convite já foi usado.", 422, null, false);
      r.state = "claimed";
    },
  };
}
