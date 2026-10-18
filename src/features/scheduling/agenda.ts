// Regras de apresentação da agenda: ocupação, linha do tempo do dia e textos de estado.
// Capacidade e conflito são decididos pelo servidor (P03); aqui só se descreve o que ele devolveu.
import type { Booking, BookingStatus, ProviderService, TimeRange } from "@contracts";
import { formatTime, minutesBetween, toDate } from "./time.ts";

/** Expediente de um dia. Ainda não há contrato para isso (proposta no handoff do P04). */
export interface DayPlan {
  date: string;
  /** Intervalos de atendimento, já sem as pausas. */
  open: TimeRange[];
  pauses: TimeRange[];
  /** Bloqueio pessoal é indisponibilidade, não cliente fictício (doc06). */
  blocks: { range: TimeRange; label: string }[];
}

export const STATUS_LABEL: Record<BookingStatus, string> = {
  held: "Reserva provisória",
  confirmed: "Confirmado",
  completed: "Concluído",
  expired: "Reserva vencida",
  cancelled: "Cancelado",
  no_show: "Falta",
};

export type StatusTone = "success" | "warning" | "info" | "danger" | "neutral";

export const STATUS_TONE: Record<BookingStatus, StatusTone> = {
  held: "warning",
  confirmed: "success",
  completed: "info",
  expired: "neutral",
  cancelled: "neutral",
  no_show: "danger",
};

/** Ocupa a agenda (impede outro agendamento no mesmo horário). */
export const ACTIVE_STATUSES: readonly BookingStatus[] = ["held", "confirmed"];

export function canReschedule(b: Booking): boolean {
  return b.status === "held" || b.status === "confirmed";
}
export function canCancel(b: Booking): boolean {
  return b.status === "held" || b.status === "confirmed";
}
/** Só depois do início do atendimento. Concluir não registra pagamento. */
export function canComplete(b: Booking, now: Date): boolean {
  return b.status === "confirmed" && toDate(b.starts_at).getTime() <= now.getTime();
}

function overlapMinutes(a: TimeRange, b: TimeRange): number {
  const start = Math.max(Date.parse(a.starts_at), Date.parse(b.starts_at));
  const end = Math.min(Date.parse(a.ends_at), Date.parse(b.ends_at));
  return end > start ? Math.round((end - start) / 60_000) : 0;
}

function sumMinutes(ranges: TimeRange[]): number {
  return ranges.reduce((acc, r) => acc + minutesBetween(r.starts_at, r.ends_at), 0);
}

export interface Occupancy {
  confirmedMinutes: number;
  sellableMinutes: number;
  /** 0–100, arredondado; null quando não há minuto vendável. */
  percent: number | null;
  blockedMinutes: number;
  holds: number;
  noShows: number;
  cancellations: number;
}

/**
 * Ocupação = minutos confirmados / minutos vendáveis na janela (doc06 e ajuste do Gabriel).
 * Vendável = expediente − bloqueios. Reserva provisória não conta como confirmada;
 * faltas e cancelamentos aparecem à parte.
 */
export function occupancy(plans: DayPlan[], bookings: Booking[]): Occupancy {
  const open = plans.flatMap((p) => p.open);
  const blocks = plans.flatMap((p) => p.blocks.map((b) => b.range));
  const blockedMinutes = blocks.reduce((acc, b) => acc + open.reduce((s, o) => s + overlapMinutes(o, b), 0), 0);
  const sellableMinutes = Math.max(0, sumMinutes(open) - blockedMinutes);
  const confirmedMinutes = bookings
    .filter((b) => b.status === "confirmed" || b.status === "completed")
    .reduce((acc, b) => acc + open.reduce((s, o) => s + overlapMinutes(o, b), 0), 0);
  return {
    confirmedMinutes,
    sellableMinutes,
    percent: sellableMinutes > 0 ? Math.round((confirmedMinutes / sellableMinutes) * 100) : null,
    blockedMinutes,
    holds: bookings.filter((b) => b.status === "held").length,
    noShows: bookings.filter((b) => b.status === "no_show").length,
    cancellations: bookings.filter((b) => b.status === "cancelled").length,
  };
}

export type TimelineItem =
  | { kind: "booking"; booking: Booking; range: TimeRange }
  | { kind: "free"; range: TimeRange; minutes: number }
  | { kind: "pause"; range: TimeRange }
  | { kind: "block"; range: TimeRange; label: string };

/**
 * Linha do tempo do dia: atendimentos (inclusive cancelados, para histórico), pausas,
 * bloqueios e lacunas livres dentro do expediente com pelo menos `minFreeMinutes`.
 */
export function dayTimeline(
  plan: DayPlan | null,
  bookings: Booking[],
  minFreeMinutes = 15,
  services: ProviderService[] = [],
): TimelineItem[] {
  const items: TimelineItem[] = bookings.map((b) => ({
    kind: "booking",
    booking: b,
    range: { starts_at: b.starts_at, ends_at: b.ends_at },
  }));
  if (plan) {
    for (const p of plan.pauses) items.push({ kind: "pause", range: p });
    for (const b of plan.blocks) items.push({ kind: "block", range: b.range, label: b.label });
    // Intervalos antes/depois do serviço também ocupam a agenda (mesma regra do motor).
    const withBuffers = (b: Booking) => {
      const s = services.find((x) => x.id === b.service_id);
      return [
        Date.parse(b.starts_at) - (s?.buffer_before_min ?? 0) * 60_000,
        Date.parse(b.ends_at) + (s?.buffer_after_min ?? 0) * 60_000,
      ] as const;
    };
    const busy = [
      ...bookings.filter((b) => ACTIVE_STATUSES.includes(b.status) || b.status === "completed").map(withBuffers),
      ...plan.blocks.map((b) => [Date.parse(b.range.starts_at), Date.parse(b.range.ends_at)] as const),
    ].sort((a, b) => a[0] - b[0]);
    for (const o of plan.open) {
      let cursor = Date.parse(o.starts_at);
      const end = Date.parse(o.ends_at);
      for (const [s, e] of busy) {
        if (e <= cursor || s >= end) continue;
        if (s > cursor) pushFree(items, cursor, s, o, minFreeMinutes);
        cursor = Math.max(cursor, e);
      }
      if (cursor < end) pushFree(items, cursor, end, o, minFreeMinutes);
    }
  }
  const order: Record<TimelineItem["kind"], number> = { block: 0, pause: 1, booking: 2, free: 3 };
  return items.sort(
    (a, b) => Date.parse(a.range.starts_at) - Date.parse(b.range.starts_at) || order[a.kind] - order[b.kind],
  );
}

function pushFree(items: TimelineItem[], start: number, end: number, open: TimeRange, min: number) {
  const minutes = Math.round((end - start) / 60_000);
  if (minutes < min) return;
  // Reaproveita o offset do expediente para manter o fuso do negócio na string.
  const offset = open.starts_at.slice(19);
  items.push({
    kind: "free",
    minutes,
    range: { starts_at: isoWithOffset(start, offset), ends_at: isoWithOffset(end, offset) },
  });
}

function isoWithOffset(ms: number, offset: string): string {
  if (offset === "Z" || offset === "") return new Date(ms).toISOString().replace(".000Z", "Z");
  const sign = offset.startsWith("-") ? -1 : 1;
  const [h = 0, m = 0] = offset.slice(1).split(":").map(Number);
  const shifted = new Date(ms + sign * (h * 60 + m) * 60_000).toISOString().slice(0, 19);
  return `${shifted}${offset}`;
}

export function formatRange(r: TimeRange, timeZone: string): string {
  return `${formatTime(r.starts_at, timeZone)}–${formatTime(r.ends_at, timeZone)}`;
}

export function formatMinutes(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/** Centavos inteiros → "R$ 60,00". A divisão é só para exibição. */
export function formatCents(cents: number): string {
  return brl.format(cents / 100);
}

export function serviceName(services: ProviderService[], id: string): string {
  return services.find((s) => s.id === id)?.name ?? "Serviço";
}
