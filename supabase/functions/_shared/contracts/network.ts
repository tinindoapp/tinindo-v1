// Perfil público e indicações (P09). Perfil é projeção opt-in, nunca o CRM.
import { z } from "zod";
import { IsoDateTime, Uuid } from "./common.ts";
import { Profession } from "./context.ts";

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
