// Acesso do módulo Perfil à Edge Function `network`. Duas implementações com a mesma interface:
// HTTP (servidor real, aqui) e demonstração offline (demoApi.ts: memória da aba, rotulada, nada é salvo).
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
import { newIdempotencyKey } from "../../lib/idempotency.ts";
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
      // Nome novo e aleatório a cada foto (o mesmo gerador das chaves): nada é sobrescrito no Storage.
      const path = `${tenantId}/${newIdempotencyKey()}.${photo.ext}`;
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

// Demonstração offline em demoApi.ts (fora da regra de chave do lint: lá os ids são de registros, não chaves).
export { createDemoNetworkApi, DEMO_BUSINESS_WHATSAPP, LINK_RULES, resetDemoNetwork } from "./demoApi.ts";
