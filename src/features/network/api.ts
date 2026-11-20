// Acesso do módulo Perfil à Edge Function `network`. Duas implementações com a mesma interface:
// HTTP (servidor real) e demonstração offline (memória da aba, rotulada, nada é salvo).
import {
  AvailabilityListOutput,
  BookingLinkReviewOutput,
  BookingLinkView,
  type ProfileDetailsInput,
  PublicRequestState,
  type ProfilePublishInput,
  type PublicBookInput,
  PublicBookOutput,
  type PublicConfirmInput,
  PublicConfirmOutput,
  PublicProfile,
  PublicServicesOutput,
  type Profession,
  type ReferralCreateInput,
  ReferralLink,
} from "@contracts";
import { bookingsA, FIXED_NOW, services, tenantA } from "@contracts/fixtures.ts";
import type { z } from "zod";
import {
  type OwnerProfile,
  OwnerProfileOutput,
  type ProfileMediaInput,
  ProfileUnpublishOutput,
  ReferralClaimOutput,
  type ReferralInspectOutput,
  ReferralInspectOutput as ReferralInspectSchema,
  ReferralListOutput,
  type ReferralSummary,
} from "@contracts";
import { ApiError, type CallOptions } from "../../lib/api/client.ts";
import { completedVisits, currentReviewSummary, providePublicContact, publicBooking, setPublishedSlug } from "../../lib/demo/journey.ts";
import { readDemoSetup } from "../../lib/demo/setup.ts";
import { demoSlots } from "./demo-slots.ts";
import type { ProcessedPhoto } from "./photo.ts";

export type PublicProfileData = z.infer<typeof PublicProfile>;
export type ReferralLinkData = z.infer<typeof ReferralLink>;
export type SlotsData = z.infer<typeof AvailabilityListOutput>;
export type { OwnerProfile, ReferralInspectOutput, ReferralSummary };

export interface PublicService {
  id: string;
  name: string;
  duration_min: number;
  /** "a partir de", só com "Mostrar preços" ligado. */
  price_from_cents?: number | null;
}

/** Bucket profile-photos pelo cliente Supabase do navegador (RLS: só membro grava na pasta do negócio). */
export interface PhotoStorage {
  upload(path: string, blob: Blob, contentType: string): Promise<void>;
  remove(path: string): Promise<void>;
  publicUrl(path: string): string;
}

export type BookRequest = z.infer<typeof PublicBookOutput> & {
  /** Só na demonstração: o código que o canal enviaria (nada é enviado de verdade). */
  demoCode?: string;
};
export type BookConfirmed = z.infer<typeof PublicConfirmOutput>;
export type RequestState = z.infer<typeof PublicRequestState>;
export type BookingView = z.infer<typeof BookingLinkView>;
export type LinkReview = z.infer<typeof BookingLinkReviewOutput>["review"];

/** Nome e profissão do negócio, para sugerir o endereço e a categoria do perfil (E9). */
export interface BusinessBasics {
  name: string;
  profession: Profession;
}

export interface NetworkApi {
  /** `true` quando os dados são de demonstração (sem servidor): a UI exibe o rótulo. */
  readonly demo: boolean;
  /** Nome e profissão já informados ao criar o negócio; null se não deu para ler (a tela pede como antes). */
  getBusiness(): Promise<BusinessBasics | null>;
  getOwnProfile(): Promise<OwnerProfile | null>;
  publishProfile(input: z.input<typeof ProfilePublishInput>, idempotencyKey: string): Promise<PublicProfileData>;
  unpublishProfile(idempotencyKey: string): Promise<void>;
  /** Envia a foto já preparada para a pasta do negócio; devolve o caminho e a URL pública. */
  uploadProfilePhoto(photo: ProcessedPhoto): Promise<{ path: string; url: string }>;
  /** Apaga um arquivo da pasta do negócio (foto trocada ou removida). */
  removeProfilePhoto(path: string): Promise<void>;
  /** Foto, texto alternativo e as chaves "Mostrar foto", "Mostrar botão do WhatsApp" e "Mostrar preços". */
  setProfileMedia(input: z.input<typeof ProfileMediaInput>, idempotencyKey: string): Promise<OwnerProfile>;
  getPublicProfile(slug: string): Promise<PublicProfileData>;
  /** Serviços que o visitante pode escolher (nome e duração). Vazio se o perfil não mostra o link de reserva. */
  publicServices(slug: string): Promise<PublicService[]>;
  publicSlots(slug: string, serviceId: string, window: { starts_at: string; ends_at: string }): Promise<SlotsData>;
  /** Pede o horário: reserva provisória + código para o contato. Ainda não é confirmação. */
  book(input: z.input<typeof PublicBookInput>, idempotencyKey: string): Promise<BookRequest>;
  /** Confirma com o código recebido. */
  confirmBooking(input: z.input<typeof PublicConfirmInput>, idempotencyKey: string): Promise<BookConfirmed>;
  /** P55: estado real do envio do código, tentativas e reenvios restantes. */
  requestState(requestId: string): Promise<RequestState>;
  /** P55: reenvia o mesmo código (até 2 vezes, 30 s entre eles). */
  resendCode(requestId: string, idempotencyKey: string): Promise<RequestState>;
  /** P55 (D21): endereço ou domicílio, horário e política do perfil. */
  setProfileDetails(input: z.input<typeof ProfileDetailsInput>, idempotencyKey: string): Promise<OwnerProfile>;
  /** P55 (D20): a reserva vista pelo link com token, sem conta. */
  bookingByLink(token: string): Promise<BookingView>;
  reviewByLink(token: string, rating: number, body: string | null, idempotencyKey: string): Promise<LinkReview>;
  withdrawByLink(token: string, idempotencyKey: string): Promise<LinkReview>;
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

export function createHttpNetworkApi(
  call: Call,
  tenantId: string | null,
  storage: PhotoStorage | null = null,
  readBusiness: (tenantId: string) => Promise<BusinessBasics | null> = async () => null,
): NetworkApi {
  const tenant = tenantId ?? undefined;
  return {
    demo: false,
    async getBusiness() {
      return tenantId ? readBusiness(tenantId).catch(() => null) : null;
    },
    async getOwnProfile() {
      return (await call("/network/profile.get", OwnerProfileOutput, { tenantId: tenant })).data.profile;
    },
    async publishProfile(input, idempotencyKey) {
      return (await call("/network/profile.publish", PublicProfile, { method: "POST", tenantId: tenant, body: input, idempotencyKey })).data;
    },
    async unpublishProfile(idempotencyKey) {
      await call("/network/profile.unpublish", ProfileUnpublishOutput, { method: "POST", tenantId: tenant, body: {}, idempotencyKey });
    },
    async uploadProfilePhoto(photo) {
      if (!storage || !tenantId) throw new ApiError("PROVIDER_UNAVAILABLE", "Envio de foto indisponível.", 503, null, true);
      const path = `${tenantId}/${crypto.randomUUID()}.${photo.ext}`;
      await storage.upload(path, photo.blob, photo.type);
      return { path, url: storage.publicUrl(path) };
    },
    async removeProfilePhoto(path) {
      await storage?.remove(path);
    },
    async setProfileMedia(input, idempotencyKey) {
      const profile = (await call("/network/profile.media", OwnerProfileOutput, { method: "POST", tenantId: tenant, body: input, idempotencyKey })).data.profile;
      if (!profile) throw new ApiError("NOT_FOUND", "Perfil não encontrado.", 404, null, false);
      return profile;
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
    async requestState(requestId) {
      return (await call("/network/public.status", PublicRequestState, { method: "POST", body: { request_id: requestId } })).data;
    },
    async resendCode(requestId, idempotencyKey) {
      return (await call("/network/public.resend", PublicRequestState, { method: "POST", body: { request_id: requestId }, idempotencyKey })).data;
    },
    async setProfileDetails(input, idempotencyKey) {
      const profile = (await call("/network/profile.details", OwnerProfileOutput, { method: "POST", tenantId: tenant, body: input, idempotencyKey })).data.profile;
      if (!profile) throw new ApiError("NOT_FOUND", "Perfil não encontrado.", 404, null, false);
      return profile;
    },
    async bookingByLink(token) {
      return (await call("/network/public.booking", BookingLinkView, { method: "POST", body: { token } })).data;
    },
    async reviewByLink(token, rating, body, idempotencyKey) {
      return (await call("/network/public.review", BookingLinkReviewOutput, { method: "POST", body: { token, rating, body }, idempotencyKey })).data.review;
    },
    async withdrawByLink(token, idempotencyKey) {
      return (await call("/network/public.review_withdraw", BookingLinkReviewOutput, { method: "POST", body: { token }, idempotencyKey })).data.review;
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
  /** P55: tentativas esgotadas (horário liberado). */
  exhausted: boolean;
  resends: number;
  queuedAt: number;
  neighborhood: string | null;
  token: string | null;
}

/** Avaliação feita pelo link na demonstração (por atendimento). */
interface DemoLinkReview {
  bookingId: string;
  review: { id: string; rating: number; body: string | null; status: "published" | "withdrawn" | "hidden" };
}

interface DemoState {
  profile: OwnerProfile | null;
  /** Fotos enviadas na demonstração: caminho → URL local (blob:) da aba. */
  photos: Map<string, string>;
  referrals: DemoReferral[];
  requests: Map<string, DemoBookRequest>;
  /** Horários segurados quando a Agenda da demonstração não está carregada (testes do módulo). */
  localHolds: { starts_at: string; ends_at: string }[];
  /** P55: links da reserva (token → pedido) e avaliações feitas por eles. */
  links: Map<string, DemoBookRequest>;
  linkReviews: DemoLinkReview[];
}

const demoState: DemoState = { profile: null, photos: new Map(), referrals: [], requests: new Map(), localHolds: [], links: new Map(), linkReviews: [] };
/** Mesmas regras do banco (app.pbk_rules). */
export const LINK_RULES = { maxAttempts: 5, maxResends: 2, resendWaitSeconds: 30 } as const;
/** Número fictício do negócio A, como se estivesse conectado no canal (Mensagens) da demonstração. */
export const DEMO_BUSINESS_WHATSAPP = "+5511999990001";

// A Agenda da demonstração mostra ao dono quem pediu cada horário pelo link (como public.contact no servidor).
providePublicContact((bookingId) => {
  const r = [...demoState.requests.values()].find((x) => x.bookingId === bookingId);
  return r ? { name: r.contactName, phone_e164: r.contactPhone } : null;
});

// Ponte da demonstração (recado #115): a profissão que o dono confirma na Configuração vale para o perfil de exemplo
// (é a categoria sugerida na publicação). O leitor fica ligado desde o carregamento do módulo.
let setupProfession: Profession | null = null;
readDemoSetup("profession", (p) => {
  setupProfession = p;
});

/** Só para testes: volta a demonstração ao estado inicial. */
export function resetDemoNetwork() {
  setupProfession = null;
  demoState.profile = null;
  for (const url of demoState.photos.values()) URL.revokeObjectURL?.(url);
  demoState.photos.clear();
  setPublishedSlug(null);
  demoState.referrals = [];
  demoState.requests.clear();
  demoState.localHolds = [];
  demoState.links.clear();
  demoState.linkReviews = [];
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
  const m = p.media;
  return {
    slug: p.slug, category: p.category, area: p.area, fields: p.fields, published_at: p.published_at, reputation,
    details: p.details ?? noDetails(),
    // Como no servidor: foto e WhatsApp só com a chave ligada.
    photo: m.show_photo && m.photo_url ? { url: m.photo_url, alt: m.photo_alt } : null,
    whatsapp_e164: m.show_whatsapp ? m.whatsapp_e164 : null,
  };
}

const DEMO_TZ = tenantA.timezone;
const noDetails = (): NonNullable<OwnerProfile["details"]> => ({ address: null, home_service: false, opening_hours: null, cancellation_policy: null });
const placeOf = (d: OwnerProfile["details"] | undefined) =>
  d?.address ? { kind: "address" as const, text: d.address } : d?.home_service ? { kind: "home" as const } : null;

/** Estado do pedido para quem pediu, como app.pbk_state_json. */
function stateOf(r: DemoBookRequest, now: number): z.infer<typeof PublicRequestState> {
  const status = r.confirmed ? "confirmed" : !r.replaced && !r.exhausted && Date.parse(r.request.expires_at) > now ? "pending" : "expired";
  return {
    request_id: r.request.request_id,
    status,
    // Demonstração: nada é enviado; o canal simulado "entrega" na hora.
    delivery: "sent",
    expires_at: r.request.expires_at,
    attempts_left: Math.max(LINK_RULES.maxAttempts - r.attempts, 0),
    resends_left: Math.max(LINK_RULES.maxResends - r.resends, 0),
    resend_available_at: new Date(r.queuedAt + LINK_RULES.resendWaitSeconds * 1000).toISOString().replace(/\.\d{3}Z$/, "Z"),
  };
}

const demoMedia = (): OwnerProfile["media"] => ({
  photo_path: null, photo_url: null, photo_alt: `Foto de ${tenantA.name}`,
  show_photo: false, show_whatsapp: false, show_prices: false, whatsapp_e164: DEMO_BUSINESS_WHATSAPP,
});

export function createDemoNetworkApi(origin: string): NetworkApi {
  const now = () => new Date().toISOString();
  return {
    demo: true,
    async getBusiness() {
      return { name: tenantA.name, profession: setupProfession ?? tenantA.profession };
    },
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
        media: demoState.profile?.media ?? demoMedia(),
        details: demoState.profile?.details ?? noDetails(),
      };
      setPublishedSlug(input.slug);
      return toPublic(demoState.profile);
    },
    async unpublishProfile() {
      if (!demoState.profile) throw notFound();
      demoState.profile = { ...demoState.profile, published_at: null, version: demoState.profile.version + 1 };
      setPublishedSlug(null);
    },
    async uploadProfilePhoto(photo) {
      const path = `${tenantA.id}/${crypto.randomUUID()}.${photo.ext}`;
      const url = URL.createObjectURL(photo.blob);
      demoState.photos.set(path, url);
      return { path, url };
    },
    async removeProfilePhoto(path) {
      const url = demoState.photos.get(path);
      if (url) URL.revokeObjectURL(url);
      demoState.photos.delete(path);
    },
    async setProfileMedia(input) {
      const p = demoState.profile;
      if (!p) throw notFound();
      if (input.photo_path && !demoState.photos.has(input.photo_path)) {
        throw new ApiError("VALIDATION_ERROR", "Envie a foto de novo.", 400, null, false, "photo_path");
      }
      if (input.show_photo && !input.photo_path) throw rejected("show_photo");
      const alt = input.photo_alt?.trim();
      demoState.profile = {
        ...p,
        version: p.version + 1,
        media: {
          ...p.media,
          photo_path: input.photo_path,
          photo_url: input.photo_path ? demoState.photos.get(input.photo_path)! : null,
          photo_alt: alt || `Foto de ${tenantA.name}`,
          show_photo: input.show_photo,
          show_whatsapp: input.show_whatsapp,
          show_prices: input.show_prices,
        },
      };
      return demoState.profile;
    },
    async getPublicProfile(slug) {
      if (!demoState.profile || demoState.profile.slug !== slug) throw notFound();
      return toPublic(demoState.profile);
    },
    async publicServices(slug) {
      if (!demoState.profile || demoState.profile.slug !== slug) return [];
      return services
        .filter((s) => s.tenant_id === tenantA.id && s.active)
        .map((s) => ({
          id: s.id, name: s.name, duration_min: s.duration_min,
          ...(demoState.profile?.media.show_prices ? { price_from_cents: s.base_price_cents } : {}),
        }));
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
      const hash = JSON.stringify({ ...input, replace_existing: undefined, supersedes_request_id: undefined });
      const prior = demoState.requests.get(key);
      if (prior) {
        if (prior.hash !== hash) throw new ApiError("IDEMPOTENCY_MISMATCH", "Pedido diferente com a mesma chave.", 409, null, false);
        return prior.request;
      }
      const service = services.find((s) => s.id === input.service_id && s.tenant_id === tenantA.id);
      if (!service) throw notFound();
      const details = demoState.profile.details ?? noDetails();
      const hood = input.neighborhood?.trim() || null;
      if (details.home_service && !hood) throw new ApiError("VALIDATION_ERROR", "Informe o bairro.", 400, null, false, "neighborhood");
      const agenda = publicBooking();
      // Mesmas regras do banco: no máximo 3 pedidos por contato por hora.
      const recent = [...demoState.requests.values()].filter((r) => r.contactPhone === input.contact.phone_e164 && Date.now() - r.queuedAt < 3_600_000);
      if (recent.length >= 3) throw new ApiError("QUOTA_EXCEEDED", "Muitos pedidos.", 429, null, true, "rate_limit");
      const release = async (r: DemoBookRequest) => {
        if (agenda) await agenda.release(r.bookingId);
        else demoState.localHolds = demoState.localHolds.filter((h) => h.starts_at !== r.request.slot.starts_at);
      };
      // "Corrigir o número": o pedido anterior desta sessão é liberado antes.
      const own = input.supersedes_request_id
        ? [...demoState.requests.values()].find((r) => r.request.request_id === input.supersedes_request_id && !r.confirmed && !r.replaced && !r.exhausted)
        : undefined;
      if (own) {
        await release(own);
        own.replaced = true;
      }
      // Mesma regra do banco: o mesmo WhatsApp com pedido aguardando código só troca com replace_existing.
      const pending = [...demoState.requests.values()].find((r) => r.contactPhone === input.contact.phone_e164 && !r.confirmed && !r.replaced && !r.exhausted);
      if (pending && !input.replace_existing) {
        throw new ApiError("PENDING_REQUEST_EXISTS", "Você já tem um pedido aguardando confirmação.", 409, null, false, "contact.phone_e164", {
          request_id: pending.request.request_id, expires_at: pending.request.expires_at,
        });
      }
      if (pending) {
        await release(pending);
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
        ...(pending ? { replaced: true as const } : {}),
        service_name: service.name,
        duration_min: service.duration_min,
        price_cents: service.base_price_cents,
        place: placeOf(details),
        policy: details.cancellation_policy,
        demoCode: code,
      };
      // P55: pedido novo começa com as tentativas zeradas (o limite é por contato e por hora).
      const entry: DemoBookRequest = { request, bookingId: hold.booking_id, code, attempts: 0, confirmed: null, hash,
        serviceName: service.name, contactName: input.contact.name.trim(), contactPhone: input.contact.phone_e164, replaced: false,
        exhausted: false, resends: 0, queuedAt: Date.now(), neighborhood: details.home_service ? hood : null, token: null };
      demoState.requests.set(key, entry);
      Object.assign(request, stateOf(entry, Date.parse(FIXED_NOW)), { delivery: "queued" as const });
      return request;
    },
    async confirmBooking(input) {
      const r = [...demoState.requests.values()].find((x) => x.request.request_id === input.request_id);
      if (!r) throw notFound();
      if (r.confirmed) return r.confirmed;
      if (r.exhausted || r.attempts >= LINK_RULES.maxAttempts) throw rejected("attempts");
      if (r.replaced) throw rejected("expires_at");
      if (input.code !== r.code) {
        r.attempts += 1;
        if (r.attempts >= LINK_RULES.maxAttempts) {
          // A 5ª errada libera o horário e encerra o pedido (como no banco).
          r.exhausted = true;
          const agenda = publicBooking();
          if (agenda) await agenda.release(r.bookingId);
          else demoState.localHolds = demoState.localHolds.filter((h) => h.starts_at !== r.request.slot.starts_at);
          throw rejected("attempts");
        }
        throw new ApiError("POLICY_REJECTED", "Código não confere.", 422, null, false, "code", { attempts_left: LINK_RULES.maxAttempts - r.attempts });
      }
      await publicBooking()?.confirm(r.bookingId);
      r.token = randomToken();
      demoState.links.set(r.token, r);
      r.confirmed = {
        status: "confirmed", slot: r.request.slot, timezone: tenantA.timezone, service_name: r.serviceName,
        duration_min: r.request.duration_min, price_cents: r.request.price_cents ?? null, business_name: tenantA.name,
        place: r.request.place ?? null, policy: r.request.policy ?? null, booking_token: r.token,
      };
      return r.confirmed;
    },
    async requestState(requestId) {
      const r = [...demoState.requests.values()].find((x) => x.request.request_id === requestId);
      if (!r) throw notFound();
      return stateOf(r, Date.parse(FIXED_NOW));
    },
    async resendCode(requestId) {
      const r = [...demoState.requests.values()].find((x) => x.request.request_id === requestId);
      if (!r) throw notFound();
      if (stateOf(r, Date.parse(FIXED_NOW)).status !== "pending") throw rejected("expires_at");
      if (r.resends >= LINK_RULES.maxResends) throw new ApiError("QUOTA_EXCEEDED", "Limite de reenvios.", 429, null, false, "resend");
      if (Date.now() - r.queuedAt < LINK_RULES.resendWaitSeconds * 1000) throw new ApiError("QUOTA_EXCEEDED", "Espere.", 429, null, true, "resend_wait");
      r.resends += 1;
      r.queuedAt = Date.now();
      return stateOf(r, Date.parse(FIXED_NOW));
    },
    async setProfileDetails(input) {
      const p = demoState.profile;
      if (!p) throw notFound();
      const clean = (v: string | null | undefined) => v?.trim() || null;
      demoState.profile = { ...p, version: p.version + 1, details: {
        address: clean(input.address), home_service: input.home_service, opening_hours: clean(input.opening_hours), cancellation_policy: clean(input.cancellation_policy),
      } };
      return demoState.profile;
    },
    async bookingByLink(token) {
      const r = demoState.links.get(token);
      if (!r?.confirmed) throw notFound();
      const done = completedVisits().find((v) => v.booking_id === r.bookingId);
      const existing = demoState.linkReviews.find((x) => x.bookingId === r.bookingId)?.review ?? null;
      const p = demoState.profile;
      return {
        business: { name: tenantA.name, slug: p?.published_at ? p.slug : null, whatsapp_e164: p?.published_at && p.media.show_whatsapp ? p.media.whatsapp_e164 : null },
        service_name: r.serviceName,
        slot: done ? { starts_at: done.starts_at, ends_at: done.ends_at } : r.confirmed.slot,
        timezone: DEMO_TZ,
        status: done ? "completed" : "confirmed",
        price_cents: done?.agreed_price_cents ?? r.confirmed.price_cents ?? null,
        place: r.confirmed.place ?? null,
        policy: r.confirmed.policy ?? null,
        review: { can_review: !!done && !existing, window_days: 30, existing },
      };
    },
    async reviewByLink(token, rating, body) {
      const view = await this.bookingByLink(token);
      const r = demoState.links.get(token)!;
      const prior = demoState.linkReviews.find((x) => x.bookingId === r.bookingId);
      if (prior) {
        if (prior.review.rating === rating && prior.review.body === (body?.trim() || null)) return prior.review;
        throw rejected("already_reviewed");
      }
      if (!view.review.can_review) throw rejected("booking_status");
      const review = { id: crypto.randomUUID(), rating, body: body?.trim() || null, status: "published" as const };
      demoState.linkReviews.push({ bookingId: r.bookingId, review });
      return review;
    },
    async withdrawByLink(token) {
      const r = demoState.links.get(token);
      const prior = r && demoState.linkReviews.find((x) => x.bookingId === r.bookingId);
      if (!prior) throw notFound();
      prior.review = { ...prior.review, status: "withdrawn" };
      return prior.review;
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
