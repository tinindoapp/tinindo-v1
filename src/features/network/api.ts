// Acesso do módulo Perfil à Edge Function `network`. Duas implementações com a mesma interface:
// HTTP (servidor real) e demonstração offline (memória da aba, rotulada, nada é salvo).
import {
  AvailabilityListOutput,
  type ProfilePublishInput,
  PublicProfile,
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

export interface NetworkApi {
  /** `true` quando os dados são de demonstração (sem servidor): a UI exibe o rótulo. */
  readonly demo: boolean;
  getOwnProfile(): Promise<OwnerProfile | null>;
  publishProfile(input: z.input<typeof ProfilePublishInput>, idempotencyKey: string): Promise<PublicProfileData>;
  unpublishProfile(idempotencyKey: string): Promise<void>;
  getPublicProfile(slug: string): Promise<PublicProfileData>;
  /** Serviços que o visitante pode escolher. Vazio enquanto o catálogo público não existe. */
  publicServices(slug: string): Promise<PublicService[]>;
  publicSlots(slug: string, serviceId: string, window: { starts_at: string; ends_at: string }): Promise<SlotsData>;
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
    async publicServices() {
      // Catálogo público depende de P02 + proposta de contrato; sem fonte real, nada é inventado.
      return [];
    },
    async publicSlots(slug, serviceId, window) {
      return (await call("/network/public.slots", AvailabilityListOutput, { method: "POST", body: { slug, service_id: serviceId, window } })).data;
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

interface DemoState {
  profile: OwnerProfile | null;
  referrals: DemoReferral[];
}

const demoState: DemoState = { profile: null, referrals: [] };

/** Só para testes: volta a demonstração ao estado inicial. */
export function resetDemoNetwork() {
  demoState.profile = null;
  demoState.referrals = [];
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const notFound = () => new ApiError("NOT_FOUND", "Não encontrado.", 404, null, false);

function toPublic(p: OwnerProfile): PublicProfileData {
  if (!p.published_at) throw notFound();
  return { slug: p.slug, category: p.category, area: p.area, fields: p.fields, published_at: p.published_at, reputation: p.reputation };
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
      return toPublic(demoState.profile);
    },
    async unpublishProfile() {
      if (!demoState.profile) throw notFound();
      demoState.profile = { ...demoState.profile, published_at: null, version: demoState.profile.version + 1 };
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
    async publicSlots(_slug, serviceId) {
      const service = services.find((s) => s.id === serviceId);
      if (!service) throw notFound();
      return { slots: demoSlots(bookingsA, service, FIXED_NOW), timezone: tenantA.timezone };
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
