// Porta de dados da agenda. A tela fala só com esta interface; há duas implementações:
// - fixturePort: emula o motor do P03 sobre as fixtures do contrato v1 (demonstração, sem servidor);
// - serverPort: Edge Functions `scheduling` (P03), `crm` (P02) e, com o P05, `pricing` (ADR-0002).
import type {
  AvailabilityListInput,
  Booking,
  BookingCancelInput,
  BookingCompleteInput,
  BookingConfirmInput,
  BookingCreateInput,
  BookingNoShowInput,
  BookingRescheduleInput,
  PricingQuoteInput,
  ProviderService,
  Quote,
  ScheduleBlockCreateInput,
  ScheduleBlockRemoveInput,
  ScheduleRulesSaveInput,
  ScheduleSettings,
  TimeRange,
  WaitlistEntry,
} from "@contracts";
import type { z } from "zod";
import type { DayPlan } from "./agenda.ts";

export interface PublicBookingContact {
  name: string;
  phone_e164: string;
}

export interface CustomerRef {
  id: string;
  name: string;
  /** WhatsApp do cadastro (E.164), quando o CRM informa. Serve só para o dono abrir a conversa. */
  phone?: string | null;
}

export interface SchedulingContext {
  tenantId: string;
  tenantName: string;
  timezone: string;
  /** Recurso único do negócio no piloto (schedule.settings); null se o negócio ainda não tem recurso ativo. */
  resourceId: string | null;
}

export interface SchedulingPort {
  /** `fixture` = dados de exemplo, nada vai ao servidor. */
  readonly kind: "fixture" | "server";
  /** Relógio da fonte de dados (fixo em demonstração). */
  now(): Date;
  context(): Promise<SchedulingContext>;
  listServices(): Promise<ProviderService[]>;
  listCustomers(): Promise<CustomerRef[]>;
  /** Atendimentos que começam na janela, de todos os estados. */
  listBookings(window: TimeRange): Promise<Booking[]>;
  getBooking(id: string): Promise<Booking>;
  /** Expediente por dia; null quando a fonte ainda não informa. */
  dayPlans(window: TimeRange): Promise<DayPlan[] | null>;
  availability(input: z.input<typeof AvailabilityListInput>): Promise<{ slots: TimeRange[]; timezone: string }>;
  /**
   * Cotação do horário. null = ainda não há regras de preço ligadas (P05): a reserva usa o preço base
   * do serviço, congelado pelo servidor na confirmação, e segue sem quote_id.
   */
  quote(input: z.input<typeof PricingQuoteInput>): Promise<Quote | null>;
  create(input: z.input<typeof BookingCreateInput>, idempotencyKey: string): Promise<Booking>;
  reschedule(input: z.input<typeof BookingRescheduleInput>, idempotencyKey: string): Promise<Booking>;
  cancel(input: z.input<typeof BookingCancelInput>, idempotencyKey: string): Promise<Booking>;
  complete(input: z.input<typeof BookingCompleteInput>, idempotencyKey: string): Promise<Booking>;
  /** Reserva provisória → confirmada. O servidor confere o prazo e congela o preço. */
  confirm(input: z.input<typeof BookingConfirmInput>, idempotencyKey: string): Promise<Booking>;
  /** Confirmado → falta (depois do início); com `revert`, volta a confirmado. Motivo obrigatório. */
  noShow(input: z.input<typeof BookingNoShowInput>, idempotencyKey: string): Promise<Booking>;
  /**
   * Entradas da lista de espera (P06), só para dizer quantas pessoas aceitam um horário que ficou livre.
   * Quem decide a oferta é a tela da lista de espera.
   */
  waitlistEntries(): Promise<WaitlistEntry[]>;
  /**
   * Quem pediu o horário pelo link público (P43): nome e WhatsApp informados. null quando não há pedido
   * (atendimento criado pelo dono, por exemplo).
   */
  publicContact(bookingId: string): Promise<PublicBookingContact | null>;
  /** Expediente semanal e recurso ativo. */
  settings(): Promise<ScheduleSettings>;
  saveRules(input: z.input<typeof ScheduleRulesSaveInput>, idempotencyKey: string): Promise<ScheduleSettings>;
  createBlock(input: z.input<typeof ScheduleBlockCreateInput>, idempotencyKey: string): Promise<void>;
  removeBlock(input: z.input<typeof ScheduleBlockRemoveInput>, idempotencyKey: string): Promise<void>;
}

/**
 * Leitura sem contrato v1 publicado (ex.: listar atendimentos ou serviços). Não é erro do
 * servidor: a conexão ainda não existe. Ver proposta `booking.list` no handoff do P04.
 */
export class NotConnectedError extends Error {
  readonly notConnected = true;
  constructor(readonly what: string, readonly dependsOn: string) {
    super(`${what} ainda não está conectado (${dependsOn}).`);
    this.name = "NotConnectedError";
  }
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
