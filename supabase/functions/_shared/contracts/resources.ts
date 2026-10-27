// Equipes e recursos (P28). Aditivos ao v1; ver ADR-0031.
// Profissionais, salas, cadeiras e equipamentos; reserva composta tudo ou nada (SLOT_CONFLICT traz em `field` o tipo do
// recurso ocupado: professional, room, chair, equipment, agenda ou hours); turmas com vagas; comissão congelada na
// reserva, lançada uma vez na conclusão e estornada uma vez. Concluir cria o recebível no Caixa (P07); não é receber.
import { z } from "zod";
import { BasisPoints, Cents, IsoDateTime, SignedCents, TimeRange, TimeZone, Uuid } from "./common.ts";

export const TeamResourceKind = z.enum(["professional", "room", "chair", "equipment"]);
export type TeamResourceKind = z.infer<typeof TeamResourceKind>;

export const TeamResource = z.object({
  id: Uuid,
  kind: TeamResourceKind,
  name: z.string().min(1).max(80),
  active: z.boolean(),
  /** Comissão padrão (só profissional). */
  commission_bps: BasisPoints.nullable(),
  /** Profissional vinculado à agenda individual (P03): uma agenda não reserva por cima da outra. */
  agenda_linked: z.boolean(),
  version: z.int().min(1),
});
export type TeamResource = z.infer<typeof TeamResource>;

export const TeamCommissionRule = z.object({ professional_id: Uuid, service_id: Uuid, bps: BasisPoints });
export type TeamCommissionRule = z.infer<typeof TeamCommissionRule>;

export const TeamListInput = z.object({});
export const TeamListOutput = z.object({
  resources: z.array(TeamResource).max(500),
  commission_rules: z.array(TeamCommissionRule).max(2000),
  timezone: TimeZone,
});

export const TeamResourceSaveInput = z.object({
  /** null = criar. */
  resource_id: Uuid.nullable().default(null),
  expected_version: z.int().min(1).nullable().default(null),
  kind: TeamResourceKind,
  name: z.string().trim().min(1).max(80),
  active: z.boolean().default(true),
  commission_bps: BasisPoints.nullable().default(null),
  agenda_linked: z.boolean().default(false),
});
export const TeamResourceOutput = z.object({ resource: TeamResource });

export const TeamCommissionRuleSaveInput = z.object({
  professional_id: Uuid,
  service_id: Uuid,
  /** null remove a regra (volta a valer a comissão padrão do profissional). */
  bps: BasisPoints.nullable(),
});
export const TeamCommissionRulesOutput = z.object({ commission_rules: z.array(TeamCommissionRule).max(2000) });

/** Até 4 recursos além do profissional, sem repetição. */
const OtherResources = z.array(Uuid).max(4).refine((a) => new Set(a).size === a.length, { message: "recurso repetido" }).default([]);

export const TeamAvailabilityInput = z.object({
  service_id: Uuid,
  professional_id: Uuid,
  resource_ids: OtherResources,
  window: TimeRange,
});
export const TeamAvailabilityOutput = z.object({ slots: z.array(TimeRange).max(500), timezone: TimeZone });

export const TeamBookingStatus = z.enum(["confirmed", "completed", "cancelled"]);
export const TeamAllocated = z.object({ id: Uuid, kind: TeamResourceKind, name: z.string() });
export const TeamBooking = z.object({
  id: Uuid,
  service_id: Uuid,
  service_name: z.string().nullable(),
  customer_id: Uuid.nullable(),
  customer_name: z.string().nullable(),
  professional_id: Uuid,
  professional_name: z.string().nullable(),
  /** Todos os recursos da reserva (profissional incluído). */
  resources: z.array(TeamAllocated).max(5),
  starts_at: IsoDateTime,
  ends_at: IsoDateTime,
  status: TeamBookingStatus,
  agreed_price_cents: Cents,
  commission_bps: BasisPoints,
  /** Comissão líquida lançada (0 até concluir; volta a 0 se estornada). */
  commission_cents: SignedCents,
  receivable_id: Uuid.nullable(),
  version: z.int().min(1),
});
export type TeamBooking = z.infer<typeof TeamBooking>;

export const TeamBookingCreateInput = z.object({
  service_id: Uuid,
  customer_id: Uuid.nullable().default(null),
  professional_id: Uuid,
  resource_ids: OtherResources,
  /** O fim vem da duração do serviço. */
  starts_at: IsoDateTime,
});
export const TeamBookingOutput = z.object({ booking: TeamBooking });
export const TeamBookingCancelInput = z.object({
  booking_id: Uuid,
  expected_version: z.int().min(1),
  reason: z.string().trim().max(280).nullable().default(null),
});
export const TeamBookingCompleteInput = z.object({ booking_id: Uuid, expected_version: z.int().min(1) });

export const TeamSeat = z.object({
  id: Uuid,
  customer_id: Uuid,
  customer_name: z.string().nullable(),
  status: z.enum(["booked", "cancelled", "attended", "no_show"]),
  receivable_id: Uuid.nullable(),
  version: z.int().min(1),
});
export type TeamSeat = z.infer<typeof TeamSeat>;
export const TeamClass = z.object({
  id: Uuid,
  title: z.string(),
  service_id: Uuid,
  service_name: z.string().nullable(),
  professional_id: Uuid,
  professional_name: z.string().nullable(),
  room_id: Uuid.nullable(),
  room_name: z.string().nullable(),
  starts_at: IsoDateTime,
  ends_at: IsoDateTime,
  capacity: z.int().min(1).max(200),
  booked: z.int().min(0),
  seat_price_cents: Cents,
  commission_bps: BasisPoints,
  commission_cents: SignedCents,
  status: z.enum(["scheduled", "completed", "cancelled"]),
  seats: z.array(TeamSeat).max(400),
  version: z.int().min(1),
});
export type TeamClass = z.infer<typeof TeamClass>;
export const TeamClassOutput = z.object({ class: TeamClass });
export const TeamClassCreateInput = z.object({
  service_id: Uuid,
  professional_id: Uuid,
  room_id: Uuid.nullable().default(null),
  title: z.string().trim().min(1).max(80),
  starts_at: IsoDateTime,
  capacity: z.int().min(1).max(200),
  /** null = preço base do serviço por vaga. */
  seat_price_cents: Cents.nullable().default(null),
});
export const TeamClassEnrollInput = z.object({ class_id: Uuid, customer_id: Uuid });
export const TeamSeatCancelInput = z.object({ seat_id: Uuid, expected_version: z.int().min(1) });
export const TeamClassCancelInput = z.object({ class_id: Uuid, expected_version: z.int().min(1) });
export const TeamClassCompleteInput = z.object({
  class_id: Uuid,
  expected_version: z.int().min(1),
  /** Vagas presentes; as demais vagas ocupadas viram falta. */
  attended_seat_ids: z.array(Uuid).max(200),
});

export const TeamScheduleInput = z.object({ window: TimeRange });
export const TeamScheduleOutput = z.object({ bookings: z.array(TeamBooking).max(300), classes: z.array(TeamClass).max(100) });

export const TeamCommissionEntry = z.object({
  id: Uuid,
  professional_id: Uuid,
  professional_name: z.string().nullable(),
  booking_id: Uuid.nullable(),
  class_id: Uuid.nullable(),
  kind: z.enum(["accrual", "reversal"]),
  base_cents: Cents,
  bps: BasisPoints,
  amount_cents: SignedCents,
  reversal_of: Uuid.nullable(),
  reversed: z.boolean(),
  created_at: IsoDateTime,
});
export type TeamCommissionEntry = z.infer<typeof TeamCommissionEntry>;
export const TeamCommissionReverseInput = z.object({ entry_id: Uuid });
export const TeamCommissionEntryOutput = z.object({ entry: TeamCommissionEntry });
export const TeamCommissionsInput = z.object({ period: TimeRange });
export const TeamCommissionTotals = z.object({
  professional_id: Uuid,
  professional_name: z.string(),
  base_cents: Cents,
  accrued_cents: Cents,
  reversed_cents: SignedCents,
  net_cents: SignedCents,
  entries: z.int().min(0),
});
export type TeamCommissionTotals = z.infer<typeof TeamCommissionTotals>;
export const TeamCommissionsOutput = z.object({
  professionals: z.array(TeamCommissionTotals).max(500),
  entries: z.array(TeamCommissionEntry).max(200),
});
