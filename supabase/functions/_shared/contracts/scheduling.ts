// Agenda e reservas (P03/P04). Agenda é a única autoridade sobre capacidade.
import { z } from "zod";
import { Cents, IsoDateTime, TimeRange, Uuid, Version } from "./common.ts";

/** held → confirmed → completed; held → expired; confirmed → cancelled | no_show. */
export const BookingStatus = z.enum([
  "held",
  "confirmed",
  "completed",
  "expired",
  "cancelled",
  "no_show",
]);
export type BookingStatus = z.infer<typeof BookingStatus>;

export const BOOKING_TRANSITIONS: Readonly<Record<BookingStatus, readonly BookingStatus[]>> = {
  held: ["confirmed", "expired", "cancelled"],
  confirmed: ["completed", "cancelled", "no_show"],
  completed: [],
  expired: [],
  cancelled: [],
  // no_show é reversível com motivo (doc06), voltando a confirmed.
  no_show: ["confirmed"],
};

export const BookingSource = z.enum(["owner", "public_link", "waitlist", "agent", "import"]);

/** Visão do dono. Cliente/visitante recebem projeções menores (P09). */
export const Booking = z.object({
  id: Uuid,
  tenant_id: Uuid,
  resource_id: Uuid,
  customer_id: Uuid.nullable(),
  service_id: Uuid,
  starts_at: IsoDateTime,
  ends_at: IsoDateTime,
  status: BookingStatus,
  hold_expires_at: IsoDateTime.nullable(),
  price_quote_id: Uuid.nullable(),
  /** Preço congelado na confirmação; não muda com regra posterior. */
  agreed_price_cents: Cents.nullable(),
  source: BookingSource,
  version: Version,
});
export type Booking = z.infer<typeof Booking>;

export const AvailabilityListInput = z.object({
  resource_id: Uuid,
  service_id: Uuid,
  window: TimeRange,
});
/** Slot livre: sem dados de quem ocupa os outros horários. */
export const Slot = TimeRange;
export const AvailabilityListOutput = z.object({
  slots: z.array(Slot).max(500),
  timezone: z.string(),
});

export const BookingCreateInput = z.object({
  customer_id: Uuid.nullable(),
  /** Referência de visitante sem login (link público); exclusiva com customer_id. */
  guest_ref: z.string().min(1).max(80).nullable().default(null),
  service_id: Uuid,
  resource_id: Uuid,
  slot: TimeRange,
  quote_id: Uuid.nullable(),
  /** `hold` cria reserva provisória com prazo; `confirm` confirma direto (dono). */
  mode: z.enum(["hold", "confirm"]),
});
export const BookingOutput = z.object({ booking: Booking });

export const BookingRescheduleInput = z.object({
  booking_id: Uuid,
  expected_version: Version,
  slot: TimeRange,
  quote_id: Uuid.nullable(),
});

export const BookingCancelInput = z.object({
  booking_id: Uuid,
  expected_version: Version,
  reason: z.string().trim().min(1).max(280),
});

export const BookingCompleteInput = z.object({
  booking_id: Uuid,
  expected_version: Version,
});
