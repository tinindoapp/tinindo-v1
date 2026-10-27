// Portas do módulo Equipe (P28). Demonstração: emulação na aba, sempre rotulada; servidor: Edge Function `resources`.
import type {
  ProviderService,
  TeamBooking,
  TeamBookingCreateInput,
  TeamClass,
  TeamClassCreateInput,
  TeamCommissionEntry,
  TeamCommissionRule,
  TeamCommissionTotals,
  TeamResource,
  TeamResourceSaveInput,
  TimeRange,
} from "@contracts";
import type { z } from "zod";

export type ResourceInput = z.input<typeof TeamResourceSaveInput>;
export type BookingInput = z.input<typeof TeamBookingCreateInput>;
export type ClassInput = z.input<typeof TeamClassCreateInput>;
export type { ProviderService, TeamBooking, TeamClass, TeamCommissionEntry, TeamCommissionRule, TeamCommissionTotals, TeamResource, TimeRange };

export interface TeamBase {
  timezone: string;
  customers: { id: string; name: string }[];
  services: ProviderService[];
  /** Instante de referência (relógio da demonstração ou do aparelho). */
  now: string;
}

export interface TeamCommissions {
  professionals: TeamCommissionTotals[];
  entries: TeamCommissionEntry[];
}

export interface ResourcesPort {
  readonly kind: "demo" | "server";
  base(): Promise<TeamBase>;
  list(): Promise<{ resources: TeamResource[]; commission_rules: TeamCommissionRule[] }>;
  save(input: ResourceInput, key: string): Promise<TeamResource>;
  saveRule(professionalId: string, serviceId: string, bps: number | null, key: string): Promise<TeamCommissionRule[]>;
  availability(serviceId: string, professionalId: string, resourceIds: string[], window: TimeRange): Promise<TimeRange[]>;
  book(input: BookingInput, key: string): Promise<TeamBooking>;
  cancelBooking(b: TeamBooking, reason: string | null, key: string): Promise<TeamBooking>;
  completeBooking(b: TeamBooking, key: string): Promise<TeamBooking>;
  schedule(window: TimeRange): Promise<{ bookings: TeamBooking[]; classes: TeamClass[] }>;
  createClass(input: ClassInput, key: string): Promise<TeamClass>;
  enroll(classId: string, customerId: string, key: string): Promise<TeamClass>;
  cancelSeat(seatId: string, version: number, key: string): Promise<TeamClass>;
  cancelClass(c: TeamClass, key: string): Promise<TeamClass>;
  completeClass(c: TeamClass, attendedSeatIds: string[], key: string): Promise<TeamClass>;
  commissions(period: TimeRange): Promise<TeamCommissions>;
  reverseCommission(entryId: string, key: string): Promise<TeamCommissionEntry>;
}

export const newKey = () => crypto.randomUUID();
