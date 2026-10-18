// Datas e horários no fuso do negócio (ADR-0004). O fuso do navegador nunca entra na conta:
// instantes vêm com offset do servidor e são exibidos/convertidos com o timezone IANA do tenant.

/** Data civil YYYY-MM-DD. */
export type CivilDate = string;

const partsCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = partsCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
    });
    partsCache.set(timeZone, f);
  }
  return f;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "2026-10-20" → [2026, 10, 20]; "09:30" → [9, 30]. */
function nums(value: string, sep: string): [number, number, number] {
  const [a = 0, b = 0, c = 0] = value.split(sep).map(Number);
  return [a, b, c];
}

export interface LocalParts {
  date: CivilDate;
  /** HH:MM */
  time: string;
  /** 0 = domingo */
  weekday: number;
  minutesOfDay: number;
}

interface RawParts {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  second: string;
  weekday: string;
}

function rawParts(instant: Date, timeZone: string): RawParts {
  const p: Record<string, string> = {};
  for (const part of partsFormatter(timeZone).formatToParts(instant)) p[part.type] = part.value;
  return {
    year: p.year ?? "1970",
    month: p.month ?? "01",
    day: p.day ?? "01",
    hour: p.hour ?? "00",
    minute: p.minute ?? "00",
    second: p.second ?? "00",
    weekday: p.weekday ?? "Sun",
  };
}

export function toDate(value: Date | string | number): Date {
  return value instanceof Date ? value : new Date(value);
}

/** Diferença, em minutos, entre o horário local do fuso e UTC naquele instante. */
export function offsetMinutes(value: Date | string | number, timeZone: string): number {
  const instant = toDate(value);
  const p = rawParts(instant, timeZone);
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  const truncated = Math.floor(instant.getTime() / 1000) * 1000;
  return Math.round((asUtc - truncated) / 60_000);
}

export function localParts(value: Date | string | number, timeZone: string): LocalParts {
  const p = rawParts(toDate(value), timeZone);
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    time: `${p.hour}:${p.minute}`,
    weekday: WEEKDAYS.indexOf(p.weekday),
    minutesOfDay: +p.hour * 60 + +p.minute,
  };
}

function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

/** ISO 8601 com o offset do fuso do negócio, ex.: 2026-10-20T09:00:00-03:00. */
export function toZonedIso(value: Date | string | number, timeZone: string): string {
  const instant = toDate(value);
  const p = rawParts(instant, timeZone);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${formatOffset(offsetMinutes(instant, timeZone))}`;
}

/**
 * Instante correspondente a um horário de parede local. Duas passadas acertam o offset
 * em dias de mudança de horário; um horário inexistente (salto) cai logo depois do salto.
 */
export function zonedInstant(date: CivilDate, time: string, timeZone: string): Date {
  const [y, m, d] = nums(date, "-");
  const [hh, mm] = nums(time, ":");
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  let guess = wall - offsetMinutes(wall, timeZone) * 60_000;
  guess = wall - offsetMinutes(guess, timeZone) * 60_000;
  return new Date(guess);
}

export function addDays(date: CivilDate, days: number): CivilDate {
  const [y, m, d] = nums(date, "-");
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function weekdayOf(date: CivilDate): number {
  const [y, m, d] = nums(date, "-");
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Segunda-feira da semana da data (semana de trabalho começa na segunda). */
export function weekStart(date: CivilDate): CivilDate {
  return addDays(date, -((weekdayOf(date) + 6) % 7));
}

export function isCivilDate(value: string | null | undefined): value is CivilDate {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return addDays(value, 0) === value;
}

/** Janela semiaberta [00:00 local, 00:00 local do dia seguinte), com offsets do fuso. */
export function dayWindow(date: CivilDate, timeZone: string, days = 1) {
  return {
    starts_at: toZonedIso(zonedInstant(date, "00:00", timeZone), timeZone),
    ends_at: toZonedIso(zonedInstant(addDays(date, days), "00:00", timeZone), timeZone),
  };
}

export function minutesBetween(a: Date | string, b: Date | string): number {
  return Math.round((toDate(b).getTime() - toDate(a).getTime()) / 60_000);
}

// Formatação para a interface (pt-BR), sempre no fuso do negócio.
export function formatTime(value: Date | string, timeZone: string): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(
    toDate(value),
  );
}

function civilToDate(date: CivilDate): Date {
  const [y, m, d] = nums(date, "-");
  return new Date(Date.UTC(y, m - 1, d, 12));
}

/** "terça-feira, 20 de outubro" */
export function formatDayLong(date: CivilDate): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }).format(
    civilToDate(date),
  );
}

/** "ter., 20/10" */
export function formatDayShort(date: CivilDate): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", weekday: "short", day: "2-digit", month: "2-digit" }).format(
    civilToDate(date),
  );
}

/** "UTC−03:00" para explicar em que fuso os horários estão. */
export function formatUtcOffset(value: Date | string, timeZone: string): string {
  return `UTC${formatOffset(offsetMinutes(value, timeZone)).replace("-", "−")}`;
}
