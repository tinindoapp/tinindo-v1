// Agenda e reservas (P03/P04). Agenda é a única autoridade sobre capacidade.
import { z } from "zod";
import { Cents, IsoDateTime, TimeRange, Uuid, Version, WeeklyWindow } from "./common.ts";

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

export const BookingSource = z.enum(["owner", "public_link", "waitlist", "agent", "import", "quote"]);

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
  /** Motivo informado ao cancelar ou marcar falta; null nos outros estados. Só na visão do dono. */
  status_reason: z.string().max(280).nullable(),
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

// ---------------------------------------------------------------------------
// Operações complementares do motor (P03). Aditivas ao v1; ver ADR-0008.
// ---------------------------------------------------------------------------

/** held → confirmed. O prazo do hold é conferido no banco. */
export const BookingConfirmInput = z.object({
  booking_id: Uuid,
  expected_version: Version,
});

/** confirmed → no_show (depois do início) ou, com `revert`, no_show → confirmed. Motivo obrigatório. */
export const BookingNoShowInput = z.object({
  booking_id: Uuid,
  expected_version: Version,
  reason: z.string().trim().min(1).max(280),
  revert: z.boolean().default(false),
});

/** Recorrência semanal finita, sempre confirmada pelo dono; cada ocorrência é uma reserva. */
export const BookingCreateSeriesInput = z.object({
  customer_id: Uuid.nullable(),
  guest_ref: z.string().min(1).max(80).nullable().default(null),
  service_id: Uuid,
  resource_id: Uuid,
  /** Primeira ocorrência; as demais repetem a mesma hora local a cada 7 dias. */
  slot: TimeRange,
  weeks: z.int().min(2).max(12),
  /** true: um conflito desfaz tudo (409). false: cria as livres e devolve os conflitos. */
  all_or_nothing: z.boolean(),
});
export const BookingCreateSeriesOutput = z.object({
  series_id: Uuid,
  created: z.array(Booking).min(1).max(12),
  conflicts: z.array(TimeRange).max(12),
});

export const BookingListInput = z.object({
  /** Atendimentos que COMEÇAM na janela (até 62 dias), de todos os estados. */
  window: TimeRange,
  cursor: z.string().min(1).max(512).optional(),
  limit: z.int().min(1).max(100).default(100),
});
export const BookingListOutput = z.object({
  bookings: z.array(Booking).max(100),
  next_cursor: z.string().nullable(),
});

export const BookingGetInput = z.object({ booking_id: Uuid });

export const AvailabilityBlock = z.object({
  id: Uuid,
  range: TimeRange,
  label: z.string().min(1).max(80),
  version: Version,
});
export type AvailabilityBlock = z.infer<typeof AvailabilityBlock>;

/** Expediente de um dia local: períodos abertos, pausas entre eles e bloqueios pessoais. */
export const DayPlan = z.object({
  date: z.iso.date(),
  open: z.array(TimeRange),
  pauses: z.array(TimeRange),
  blocks: z.array(AvailabilityBlock),
});
export type DayPlan = z.infer<typeof DayPlan>;

export const ScheduleDayPlansInput = z.object({ window: TimeRange });
export const ScheduleDayPlansOutput = z.object({
  resource_id: Uuid,
  timezone: z.string(),
  days: z.array(DayPlan).max(63),
});

/** Recurso ativo do negócio (piloto: um), timezone e expediente semanal em horário local. */
export const ScheduleSettings = z.object({
  resource_id: Uuid,
  resource_version: Version,
  timezone: z.string(),
  rules: z.array(WeeklyWindow).max(50),
});
export type ScheduleSettings = z.infer<typeof ScheduleSettings>;
export const ScheduleSettingsInput = z.object({});

export const ScheduleRulesSaveInput = z.object({
  resource_id: Uuid,
  /** Versão do recurso lida em schedule.settings. */
  expected_version: Version,
  rules: z.array(WeeklyWindow).max(50),
});

export const ScheduleBlockCreateInput = z.object({
  resource_id: Uuid,
  range: TimeRange,
  label: z.string().trim().min(1).max(80),
});
export const ScheduleBlockRemoveInput = z.object({ block_id: Uuid, expected_version: Version });
export const ScheduleBlockOutput = z.object({ block: AvailabilityBlock });
