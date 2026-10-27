// Complemento LOCAL de demonstração do P04 (fictício). Tudo que não existe nas fixtures do
// contrato v1 e de que a tela precisa: nomes de clientes, expediente, bloqueio, uma regra de
// horário e a política de cancelamento. Some quando o P03/P02/P05 publicarem as leituras reais.
import { FX, bookingsA } from "@contracts/fixtures.ts";
import type { Booking, WaitlistEntry } from "@contracts";

export const DEMO_CUSTOMERS = [
  { id: FX.customers.abInA, name: "Cliente Exemplo Ana" },
  { id: FX.customers.guestInA, name: "Cliente Exemplo Bruno" },
] as const;

/** Expediente local (0 = domingo). Pausa de almoço fora dos intervalos abertos. */
export const DEMO_WEEKLY_HOURS: Record<number, { open: [string, string][]; pauses: [string, string][] }> = {
  1: { open: [["09:00", "12:00"], ["13:00", "19:00"]], pauses: [["12:00", "13:00"]] },
  2: { open: [["09:00", "12:00"], ["13:00", "19:00"]], pauses: [["12:00", "13:00"]] },
  3: { open: [["09:00", "12:00"], ["13:00", "19:00"]], pauses: [["12:00", "13:00"]] },
  4: { open: [["09:00", "12:00"], ["13:00", "19:00"]], pauses: [["12:00", "13:00"]] },
  5: { open: [["09:00", "12:00"], ["13:00", "19:00"]], pauses: [["12:00", "13:00"]] },
  6: { open: [["09:00", "14:00"]], pauses: [] },
};

/** Bloqueio pessoal (indisponibilidade), quinta 22/10. */
export const DEMO_BLOCKS = [
  { date: "2026-10-22", from: "14:00", to: "16:00", label: "Compromisso pessoal" },
];

/**
 * Regra de horário já aprovada (emulação do P05): terça à tarde 15% de desconto, respeitando
 * o piso do serviço. Explica o preço de R$ 51,00 da fixture das 15:00.
 */
export const DEMO_OFF_PEAK = { weekday: 2, from: "13:00", to: "17:00", discount_bps: 1500, rule_version: 3 };

/** Política de cancelamento de exemplo. A real vem da configuração do negócio (versão guardada). */
export const DEMO_CANCELLATION_POLICY = {
  version: "exemplo-1",
  text: "Cancelamento ou troca de horário sem custo até 2 horas antes. Depois disso, o profissional combina com o cliente. Nenhuma multa é cobrada automaticamente.",
};

const extra = (n: number, starts: string, ends: string, service: string, customer: string | null, status: Booking["status"], price: number | null): Booking => ({
  id: `60000000-0000-4000-8000-${String(100 + n).padStart(12, "0")}`,
  tenant_id: FX.tenants.A,
  resource_id: FX.resources.A,
  customer_id: customer,
  service_id: service,
  starts_at: starts,
  ends_at: ends,
  status,
  hold_expires_at: null,
  price_quote_id: null,
  agreed_price_cents: price,
  source: "owner",
  version: 1,
});

/** Semana de 19/10 além da terça das fixtures: concluídos, falta, cancelamento e confirmado. Os concluídos são os do Caixa. */
export const DEMO_EXTRA_BOOKINGS: Booking[] = [
  extra(1, "2026-10-19T14:00:00-03:00", "2026-10-19T14:30:00-03:00", FX.services.corteA, FX.customers.abInA, "completed", 6000),
  extra(2, "2026-10-19T16:00:00-03:00", "2026-10-19T16:20:00-03:00", FX.services.barbaA, FX.customers.guestInA, "no_show", 4000),
  extra(3, "2026-10-21T10:00:00-03:00", "2026-10-21T10:30:00-03:00", FX.services.corteA, FX.customers.guestInA, "cancelled", 6000),
  extra(4, "2026-10-22T09:00:00-03:00", "2026-10-22T09:30:00-03:00", FX.services.corteA, FX.customers.abInA, "confirmed", 6000),
  // Mesmo atendimento que o Caixa de exemplo lista como concluído sem cobrança (barba do Bruno, segunda 16:30).
  extra(5, "2026-10-19T16:30:00-03:00", "2026-10-19T16:50:00-03:00", FX.services.barbaA, FX.customers.guestInA, "completed", 4000),
];

export function demoBookings(): Booking[] {
  return [...bookingsA, ...DEMO_EXTRA_BOOKINGS].map((b) => ({ ...b }));
}

/**
 * Lista de espera de exemplo: a mesma entrada da tela Lista de espera da demonstração (src/features/waitlist/demoPort.ts).
 * Ana espera um Corte às quartas, das 09:00 às 19:00. Quem entrar na lista por aquela tela não aparece aqui.
 */
export const DEMO_WAITLIST: WaitlistEntry[] = [
  {
    id: "71000000-0000-4000-8000-000000000001", tenant_id: FX.tenants.A, customer_id: FX.customers.abInA, service_id: FX.services.corteA,
    status: "active", joined_at: "2026-10-18T13:00:00Z", valid_until: "2026-11-19T12:00:00Z",
    acceptable_windows: [{ weekday: 3, local_start: "09:00", local_end: "19:00" }], version: 1,
  },
];
