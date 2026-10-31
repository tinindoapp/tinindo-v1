// Eventos de domínio (outbox). Entrega ao menos uma vez; consumidor deduplica event_id.
import { z } from "zod";
import { IsoDateTime, Uuid } from "./common.ts";

export const EventType = z.enum([
  "booking.confirmed.v1",
  "booking.cancelled.v1",
  "booking.completed.v1",
  "booking.rescheduled.v1",
  "booking.hold_released.v1",
  "payment.recorded.v1",
  "waitlist.offer.expired.v1",
  "agent.action.approved.v1",
  "sales.quote.accepted.v1",
  "sales.quote.declined.v1",
  "channel.message.received.v1",
  "channel.message.failed.v1",
  "recurrence.cycle.opened.v1",
  "referral.rewarded.v1",
  "campaign.approved.v1",
  "campaign.closed.v1",
  "content.published.v1",
  "presence.site.published.v1",
  "presence.domain.verified.v1",
  "fiscal.document.authorized.v1",
  "review.published.v1",
]);
export type EventType = z.infer<typeof EventType>;

export const EventEnvelope = z.object({
  event_id: Uuid,
  event_type: EventType,
  tenant_id: Uuid,
  aggregate_id: Uuid,
  aggregate_version: z.int().min(1),
  occurred_at: IsoDateTime,
  schema_version: z.literal(1),
  correlation_id: Uuid,
  /** Payload mínimo: IDs e valores necessários, sem PII desnecessária. */
  payload: z.record(z.string(), z.unknown()),
});
export type EventEnvelope = z.infer<typeof EventEnvelope>;

/** Estados da entrega por portas externas: só o provedor confirma `delivered`. */
export const DeliveryState = z.enum([
  "prepared",
  "share_opened",
  "sent",
  "delivered",
  "failed",
  "delivery_unknown",
]);
