// Lista de espera (P06). Abrir link não reserva; aceite é POST idempotente.
import { z } from "zod";
import { Cents, IsoDateTime, TimeRange, Uuid, Version, WeeklyWindow } from "./common.ts";
import { DeliveryState } from "./events.ts";

export const WaitlistEntryStatus = z.enum(["active", "offered", "fulfilled", "withdrawn", "expired"]);
export const WaitlistOfferStatus = z.enum([
  "pending_approval",
  "offered",
  "accepted",
  "declined",
  "expired",
  "invalidated",
]);

export const WaitlistJoinInput = z.object({
  customer_id: Uuid,
  service_id: Uuid,
  acceptable_windows: z.array(WeeklyWindow).min(1).max(14),
  /** Consentimento registrado para contato sobre vaga (finalidade transacional). */
  consent_id: Uuid,
  valid_until: IsoDateTime,
});
export const WaitlistEntry = z.object({
  id: Uuid,
  tenant_id: Uuid,
  customer_id: Uuid,
  service_id: Uuid,
  status: WaitlistEntryStatus,
  joined_at: IsoDateTime,
  valid_until: IsoDateTime,
  /** Aditivos (P06). */
  acceptable_windows: z.array(WeeklyWindow).optional(),
  version: z.int().min(1).optional(),
});
export type WaitlistEntry = z.infer<typeof WaitlistEntry>;

export const WaitlistPrepareOfferInput = z.object({
  entry_id: Uuid,
  slot: TimeRange,
  quote_id: Uuid,
});
export const WaitlistOffer = z.object({
  id: Uuid,
  entry_id: Uuid,
  booking_hold_id: Uuid,
  quote_id: Uuid,
  status: WaitlistOfferStatus,
  /** Menor prazo entre oferta, cotação e hold. */
  expires_at: IsoDateTime,
  /** Aditivos (P06). Compartilhamento manual só chega a `share_opened`; nunca `delivered`. */
  delivery_state: DeliveryState.optional(),
  version: z.int().min(1).optional(),
  /** Token do link: só na resposta que cria a oferta; repetição devolve null (o banco guarda só o hash). */
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/).nullable().optional(),
});
export type WaitlistOffer = z.infer<typeof WaitlistOffer>;

export const WaitlistAcceptOfferInput = z.object({
  /** Token opaco do link; o banco guarda apenas o hash. */
  token: z.string().min(32).max(256),
});

// ---------------------------------------------------------------------------
// Operações complementares (P06). Aditivas ao v1; ver ADR-0011.
// ---------------------------------------------------------------------------

export const ConsentRecordInput = z.object({
  customer_id: Uuid,
  purpose: z.literal("waitlist_offer"),
  /** Piloto: o dono compartilha o link manualmente (sem envio automático). */
  channel: z.literal("manual_share"),
});
export const ContactConsent = z.object({
  consent_id: Uuid,
  customer_id: Uuid,
  purpose: z.literal("waitlist_offer"),
  channel: z.literal("manual_share"),
  granted_at: IsoDateTime,
});
export const ConsentRevokeInput = z.object({ consent_id: Uuid });
export const ConsentRevokeOutput = z.object({ consent_id: Uuid, revoked_at: IsoDateTime });

export const WaitlistWithdrawInput = z.object({ entry_id: Uuid, expected_version: Version });
export const WaitlistOfferRefInput = z.object({ offer_id: Uuid });

export const WaitlistCandidate = z.object({
  id: Uuid,
  entry_id: Uuid,
  slot: TimeRange,
  status: z.enum(["open", "offered", "stale"]),
});
export const WaitlistListInput = z.object({});
export const WaitlistListOutput = z.object({
  entries: z.array(WaitlistEntry).max(200),
  /** Vagas liberadas que servem a uma entrada, na ordem da fila (uma pessoa de cada vez). */
  candidates: z.array(WaitlistCandidate),
  offers: z.array(WaitlistOffer).max(50),
});

/** O que o link mostra a quem recebeu: sem tenant, sem outros clientes. */
export const WaitlistOfferView = z.object({
  business_name: z.string(),
  service_name: z.string(),
  slot: TimeRange,
  timezone: z.string(),
  price_cents: Cents,
  status: WaitlistOfferStatus,
  expires_at: IsoDateTime,
});
export const WaitlistDeclineOutput = z.object({ status: z.literal("declined") });
