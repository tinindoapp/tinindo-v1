// "Repetir toda semana" (decisão D8 a): contas puras da tela. `booking.create_series` repete um horário por 2 a 12
// semanas, em um ou vários dias da semana, tudo com um series_id só. "Até a data" vira número de semanas; quando os
// dias ficam com números de semanas diferentes (a data cai no meio de uma semana), vira uma chamada por dia.
// Quem decide conflito é o servidor: aqui só se monta o pedido e se descreve o que ele devolveu.
import type { Booking, TimeRange } from "@contracts";
import { addDays, type CivilDate, formatDayShort, toZonedIso, weekdayOf, zonedInstant } from "./time.ts";

/** Limites do contrato (BookingCreateSeriesInput.weeks). */
export const SERIES_MIN_WEEKS = 2;
export const SERIES_MAX_WEEKS = 12;

export type SeriesEnd = { kind: "weeks"; weeks: number } | { kind: "until"; date: CivilDate };

export interface SeriesOccurrence {
  date: CivilDate;
  slot: TimeRange;
}

/** Uma chamada a `booking.create_series`: os dias da semana, quantas semanas e as datas (a primeira é o `slot`). */
export interface SeriesCall {
  weekdays: number[];
  weeks: number;
  occurrences: SeriesOccurrence[];
}

export type SeriesField = "weekdays" | "time" | "end";
export type SeriesPlan =
  | { ok: true; calls: SeriesCall[]; occurrences: SeriesOccurrence[] }
  | { ok: false; field: SeriesField; message: string };

const WEEKDAY_NAME = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

function joinList(items: string[]): string {
  return items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} e ${items.at(-1)}`;
}

/** Segunda primeiro, domingo por último (ordem da semana de trabalho). */
function weekOrder(weekdays: readonly number[]): number[] {
  return [...new Set(weekdays)].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
}

/** "terça e quinta, às 07:00" */
export function describeSeries(weekdays: readonly number[], time: string): string {
  return `${joinList(weekOrder(weekdays).map((d) => WEEKDAY_NAME[d]!))}, às ${time}`;
}

/**
 * Monta as chamadas. Cada dia da semana começa na primeira data a partir de `startDate` cujo horário ainda não passou
 * (o servidor recusa a série inteira se a primeira ocorrência estiver no passado). O horário é o de parede do negócio
 * em cada data, como o servidor faz.
 */
export function planSeries(input: {
  startDate: CivilDate;
  weekdays: readonly number[];
  time: string;
  durationMin: number;
  end: SeriesEnd;
  timeZone: string;
  now: Date;
}): SeriesPlan {
  const { startDate, time, durationMin, end, timeZone, now } = input;
  const weekdays = weekOrder(input.weekdays);
  if (weekdays.length === 0) return { ok: false, field: "weekdays", message: "Escolha pelo menos um dia da semana." };
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return { ok: false, field: "time", message: "Informe o horário, como 07:00." };
  if (end.kind === "weeks" && !(Number.isInteger(end.weeks) && end.weeks >= SERIES_MIN_WEEKS && end.weeks <= SERIES_MAX_WEEKS)) {
    return { ok: false, field: "end", message: `Informe de ${SERIES_MIN_WEEKS} a ${SERIES_MAX_WEEKS} semanas.` };
  }
  const slotOf = (date: CivilDate): TimeRange => {
    const start = zonedInstant(date, time, timeZone).getTime();
    return { starts_at: toZonedIso(start, timeZone), ends_at: toZonedIso(start + durationMin * 60_000, timeZone) };
  };
  const calls: SeriesCall[] = [];
  for (const weekday of weekdays) {
    let first = addDays(startDate, (weekday - weekdayOf(startDate) + 7) % 7);
    if (Date.parse(slotOf(first).starts_at) <= now.getTime()) first = addDays(first, 7);
    let weeks: number;
    if (end.kind === "weeks") {
      weeks = end.weeks;
    } else {
      // Datas civis YYYY-MM-DD comparam como texto.
      weeks = 0;
      for (let d = first; d <= end.date && weeks <= SERIES_MAX_WEEKS; d = addDays(d, 7)) weeks += 1;
      if (weeks < SERIES_MIN_WEEKS) {
        return {
          ok: false,
          field: "end",
          message: `Até esta data, ${WEEKDAY_NAME[weekday]} ${weeks === 1 ? "teria só 1 atendimento" : "não teria nenhum atendimento"}. A repetição precisa de pelo menos ${SERIES_MIN_WEEKS} semanas: escolha uma data mais adiante.`,
        };
      }
      if (weeks > SERIES_MAX_WEEKS) {
        const last = addDays(first, 7 * (SERIES_MAX_WEEKS - 1) + 6);
        return {
          ok: false,
          field: "end",
          message: `A repetição vai até ${SERIES_MAX_WEEKS} semanas por vez. Escolha uma data até ${formatDayShort(last)}.`,
        };
      }
    }
    const occurrences = Array.from({ length: weeks }, (_, i) => {
      const date = addDays(first, 7 * i);
      return { date, slot: slotOf(date) };
    });
    calls.push({ weekdays: [weekday], weeks, occurrences });
  }
  const byStart = (a: SeriesOccurrence, b: SeriesOccurrence) => Date.parse(a.slot.starts_at) - Date.parse(b.slot.starts_at);
  const occurrences = calls.flatMap((c) => c.occurrences).sort(byStart);
  // Mesmo número de semanas em todos os dias: uma chamada só, um series_id para a repetição inteira. O servidor começa
  // cada dia na primeira data a partir da primeira ocorrência, que é exatamente a primeira data de cada dia aqui.
  if (calls.length > 1 && calls.every((c) => c.weeks === calls[0]!.weeks)) {
    return { ok: true, calls: [{ weekdays, weeks: calls[0]!.weeks, occurrences }], occurrences };
  }
  return { ok: true, calls, occurrences };
}

/**
 * Chave de cada chamada, derivada da chave do envio: a nova tentativa manda as mesmas chaves, e a chamada que já tinha
 * dado certo devolve o mesmo resultado em vez de criar de novo.
 */
export function seriesCallKey(base: string, call: Pick<SeriesCall, "weekdays">): string {
  return `${base}-d${call.weekdays.join("")}`;
}

export interface SeriesMark {
  /** Posição na repetição, a partir de 1. */
  position: number;
  total: number;
  nextId: string | null;
}

/**
 * Posição do atendimento na repetição, a partir dos atendimentos da série lidos do servidor (`booking.series`). Os
 * cancelados contam na posição (a data existiu), mas "Abrir o próximo" pula para o próximo ainda marcado.
 */
export function seriesMark(series: readonly Booking[], bookingId: string): SeriesMark | null {
  const ordered = [...series].sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at) || a.id.localeCompare(b.id));
  const i = ordered.findIndex((b) => b.id === bookingId);
  if (i < 0 || ordered.length < 2) return null;
  const next = ordered.slice(i + 1).find((b) => b.status === "confirmed" || b.status === "held");
  return { position: i + 1, total: ordered.length, nextId: next?.id ?? null };
}

/** Quantos atendimentos da repetição, a partir deste, ainda estão marcados (o que "Cancelar os próximos" cancela). */
export function seriesRemaining(series: readonly Booking[], booking: Booking): number {
  const from = Date.parse(booking.starts_at);
  return series.filter((b) => Date.parse(b.starts_at) >= from && (b.status === "confirmed" || b.status === "held")).length;
}

/** "Repete toda semana · 3 de 16" */
export function seriesLabel(mark: SeriesMark): string {
  return `Repete toda semana · ${mark.position} de ${mark.total}`;
}
