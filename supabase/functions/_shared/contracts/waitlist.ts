// Lista de espera (P06). Abrir link não reserva; aceite é POST idempotente.
import { z } from "zod";
import { IsoDateTime, TimeRange, Uuid, WeeklyWindow } from "./common.ts";

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
});

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
});

export const WaitlistAcceptOfferInput = z.object({
  /** Token opaco do link; o banco guarda apenas o hash. */
  token: z.string().min(32).max(256),
});
