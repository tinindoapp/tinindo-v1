// Perfil público e indicações (P09). Perfil é projeção opt-in, nunca o CRM.
import { z } from "zod";
import { IsoDateTime, PhoneE164, TimeRange, Uuid } from "./common.ts";
import { Profession } from "./context.ts";
import { AvailabilityListInput } from "./scheduling.ts";

/** Campos que PODEM ser públicos. Qualquer outro campo é privado por definição. */
export const PublicProfileField = z.enum([
  "display_name",
  "category",
  "area",
  "bio",
  "services_summary",
  "booking_link",
]);

export const ProfilePublishInput = z.object({
  slug: z.string().regex(/^[a-z0-9](?:[a-z0-9-]{1,48}[a-z0-9])$/),
  category: Profession,
  area: z.string().trim().min(1).max(80),
  public_fields: z.array(PublicProfileField).min(1),
});
export const PublicProfile = z.object({
  slug: z.string(),
  category: Profession,
  area: z.string(),
  fields: z.partialRecord(PublicProfileField, z.string().max(2000)),
  published_at: IsoDateTime,
  /** Rótulos de reputação independentes; perfil novo não tem avaliações. */
  reputation: z.object({
    identity_verified: z.boolean(),
    reviews_count: z.int().min(0),
  }),
});

export const ReferralKind = z.enum(["customer_recommends_professional", "professional_invites_peer"]);
export const ReferralCreateInput = z.object({
  kind: ReferralKind,
  /** Dados mínimos; telefone de terceiro não dispara marketing. */
  invitee_name: z.string().trim().min(1).max(120),
  invitee_category: Profession.optional(),
  origin: z.enum(["web", "profile_page", "invite_link"]),
});
export const ReferralLink = z.object({
  referral_id: Uuid,
  /** URL com token opaco; nada de nome/telefone na URL. */
  share_url: z.url(),
  expires_at: IsoDateTime,
});

// ---------------------------------------------------------------------------
// Rotas complementares do P09 (perfil do dono, leitura pública, convites). Promovidas do módulo
// network pelo integrador (aditivo; ADR-0007).
// ---------------------------------------------------------------------------

export const Slug = z.string().regex(/^[a-z0-9](?:[a-z0-9-]{1,48}[a-z0-9])$/);

/** Query string de GET /network/public.profile. */
export const PublicProfileQuery = z.object({ slug: Slug });

/** Visão do dono: igual ao perfil público, mas pode estar despublicado e traz a versão. */
export const OwnerProfile = PublicProfile.extend({
  public_fields: z.array(PublicProfileField),
  published_at: IsoDateTime.nullable(),
  version: z.int().min(1),
});
export type OwnerProfile = z.infer<typeof OwnerProfile>;
export const OwnerProfileOutput = z.object({ profile: OwnerProfile.nullable() });

export const ProfileUnpublishOutput = z.object({ slug: Slug, published: z.literal(false) });

/** Token opaco (base64url, 256 bits). Vai no corpo de um POST, nunca na query string. */
export const ReferralToken = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const ReferralTokenInput = z.object({ token: ReferralToken });

export const ReferralInspectOutput = z.object({
  kind: ReferralKind,
  invitee_category: Profession.nullable(),
  state: z.enum(["open", "used", "expired"]),
  expires_at: IsoDateTime,
  inviter_profile_slug: Slug.nullable(),
});
export type ReferralInspectOutput = z.infer<typeof ReferralInspectOutput>;

export const ReferralClaimOutput = z.object({
  referral_id: Uuid,
  kind: ReferralKind,
  state: z.literal("claimed"),
});

export const ReferralState = z.enum(["pending", "claimed", "expired", "revoked"]);
export const ReferralSummary = z.object({
  referral_id: Uuid,
  kind: ReferralKind,
  invitee_name: z.string(),
  invitee_category: Profession.nullable(),
  state: ReferralState,
  created_at: IsoDateTime,
  expires_at: IsoDateTime,
});
export type ReferralSummary = z.infer<typeof ReferralSummary>;
export const ReferralListOutput = z.object({ referrals: z.array(ReferralSummary).max(50) });

/** Horários do link público: o visitante escolhe pelo slug, nunca por tenant/resource. */
export const PublicSlotsInput = z.object({
  slug: Slug,
  service_id: Uuid,
  window: AvailabilityListInput.shape.window,
});

// ---------------------------------------------------------------------------
// Reserva pelo link público (P43, ADR-0030). Pedido → código pelo canal do negócio → confirmação.
// Antes da confirmação o horário é só uma reserva provisória, que vence sozinha.
// ---------------------------------------------------------------------------

/** Serviço que o visitante escolhe: nome e duração. Preço, piso e custos ficam fora. */
export const PublicService = z.object({
  id: Uuid,
  name: z.string(),
  duration_min: z.int().min(5),
});
export const PublicServicesOutput = z.object({ services: z.array(PublicService).max(50) });

export const PublicBookInput = z.object({
  slug: Slug,
  service_id: Uuid,
  /** Início de um horário devolvido por public.slots; o fim sai da duração do serviço. */
  starts_at: IsoDateTime,
  /** Para quem vai o código. Fica só no pedido: não cria cliente no CRM. */
  contact: z.object({
    name: z.string().trim().min(1).max(80),
    phone_e164: PhoneE164,
  }),
  /** O mesmo WhatsApp já tem pedido aguardando código neste negócio: true troca o anterior por este. Sem ele → 409
   *  PENDING_REQUEST_EXISTS, com PendingRequest em error.details. */
  replace_existing: z.boolean().default(false),
});
/** Pedido que ainda aguarda código (error.details de PENDING_REQUEST_EXISTS). Só id e prazo: sem serviço, horário,
 *  nome nem telefone, para que digitar o WhatsApp de outra pessoa não revele o que ela marcou. */
export const PendingRequest = z.object({
  request_id: Uuid,
  expires_at: IsoDateTime,
});
export const PublicBookOutput = z.object({
  request_id: Uuid,
  slot: TimeRange,
  /** Depois disso o código não vale e o horário volta a ficar livre. */
  expires_at: IsoDateTime,
  /** Situação do envio do código. Enviado não é entregue. */
  delivery: z.enum(["queued", "sending", "sent", "failed", "delivery_unknown"]),
  /** true quando este pedido trocou um anterior do mesmo contato (que foi cancelado). Não diz qual era. */
  replaced: z.literal(true).optional(),
});

export const PublicConfirmInput = z.object({
  request_id: Uuid,
  code: z.string().regex(/^\d{6}$/),
});
export const PublicConfirmOutput = z.object({
  status: z.literal("confirmed"),
  slot: TimeRange,
  timezone: z.string(),
  service_name: z.string(),
});

/** Dono: nome e WhatsApp informados no pedido pelo link, para falar com quem reservou. Só o dono do negócio lê. */
export const PublicContactInput = z.object({ booking_id: Uuid });
export const PublicContactOutput = z.object({
  name: z.string(),
  phone_e164: PhoneE164,
  requested_at: IsoDateTime,
  status: z.enum(["pending", "confirmed"]),
});
