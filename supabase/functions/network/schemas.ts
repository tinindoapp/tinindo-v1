// Schemas locais do módulo network (P09) para rotas que o registro v1 ainda não cobre.
// São PROPOSTA de contrato (ver docs/handoffs/P09-claude-p09-a.md): o integrador decide se
// entram em _shared/contracts. Reaproveitam os tipos v1; nenhum DTO v1 é redefinido aqui.
import { z } from "zod";
import {
  AvailabilityListInput,
  IsoDateTime,
  Profession,
  PublicProfile,
  PublicProfileField,
  ReferralKind,
  Uuid,
} from "../_shared/contracts/index.ts";

export const Slug = z.string().regex(/^[a-z0-9](?:[a-z0-9-]{1,48}[a-z0-9])$/);

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
