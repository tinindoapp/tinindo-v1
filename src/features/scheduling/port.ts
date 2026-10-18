// Porta de dados da agenda. A tela fala só com esta interface; há duas implementações:
// - fixturePort: emula o motor do P03 sobre as fixtures do contrato v1 (demonstração, sem servidor);
// - serverPort: Edge Functions `scheduling`/`pricing` (ADR-0002), para quando o P03 estiver em main.
import type {
  AvailabilityListInput,
  Booking,
  BookingCancelInput,
  BookingCompleteInput,
  BookingCreateInput,
  BookingRescheduleInput,
  PricingQuoteInput,
  ProviderService,
  Quote,
  TimeRange,
} from "@contracts";
import type { z } from "zod";
import type { DayPlan } from "./agenda.ts";

export interface CustomerRef {
  id: string;
  name: string;
}

export interface SchedulingContext {
  tenantId: string;
  tenantName: string;
  timezone: string;
  /** Recurso único do negócio no piloto; null enquanto o servidor não informar (proposta no handoff). */
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
  quote(input: z.input<typeof PricingQuoteInput>): Promise<Quote>;
  create(input: z.input<typeof BookingCreateInput>, idempotencyKey: string): Promise<Booking>;
  reschedule(input: z.input<typeof BookingRescheduleInput>, idempotencyKey: string): Promise<Booking>;
  cancel(input: z.input<typeof BookingCancelInput>, idempotencyKey: string): Promise<Booking>;
  complete(input: z.input<typeof BookingCompleteInput>, idempotencyKey: string): Promise<Booking>;
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
