// Datas do assistente sempre no fuso do negócio (Intl: roda em Deno e no navegador).

export interface LocalParts {
  date: string;
  time: string;
  weekday: number;
}

export function localParts(at: Date | string, timeZone: string): LocalParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short",
  }).formatToParts(new Date(at));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}`, weekday: wd };
}

function offsetMinutes(at: Date, timeZone: string): number {
  const p = localParts(at, timeZone);
  const [y, m, d] = p.date.split("-").map(Number) as [number, number, number];
  const [hh, mm] = p.time.split(":").map(Number) as [number, number];
  return Math.round((Date.UTC(y, m - 1, d, hh, mm) - Math.floor(at.getTime() / 60_000) * 60_000) / 60_000);
}

/** Instante de uma data/hora civil no fuso (DST incluído). */
export function zoned(date: string, time: string, timeZone: string): Date {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const [hh, mm] = time.split(":").map(Number) as [number, number];
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const first = guess - offsetMinutes(new Date(guess), timeZone) * 60_000;
  return new Date(guess - offsetMinutes(new Date(first), timeZone) * 60_000);
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function weekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export const WEEKDAY_NAMES = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"] as const;
export const WEEKDAY_KEYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
export const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"] as const;

/** "quarta, 21/10" */
export function dayLabel(date: string): string {
  const [, m, d] = date.split("-");
  return `${WEEKDAY_NAMES[weekdayOf(date)]}, ${d}/${m}`;
}

const WEEKDAY_LONG = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"] as const;

/** "quarta-feira, 21 de outubro" */
export function longDayLabel(date: string): string {
  const [, m, d] = date.split("-").map(Number) as [number, number, number];
  return `${WEEKDAY_LONG[weekdayOf(date)]}, ${d} de ${MONTHS[m - 1]}`;
}

export function ddmm(date: string): string {
  const [, m, d] = date.split("-");
  return `${d}/${m}`;
}

export function hhmm(at: string, timeZone: string): string {
  return localParts(at, timeZone).time;
}

export interface Window {
  starts_at: string;
  ends_at: string;
}

/** Janela [início do dia a, início do dia b) em instantes ISO. */
export function dayWindow(date: string, timeZone: string, days = 1): Window {
  return { starts_at: zoned(date, "00:00", timeZone).toISOString(), ends_at: zoned(addDays(date, days), "00:00", timeZone).toISOString() };
}

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
/** Centavos → "R$ 60,00" (espaço comum, para leitura e busca estáveis). */
export function money(cents: number): string {
  return BRL.format(cents / 100).replace(/\s/g, " ");
}

/** 140 → "2h20"; 540 → "9h"; 45 → "45 min". */
export function duration(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const r = min % 60;
  return r ? `${h}h${String(r).padStart(2, "0")}` : `${h}h`;
}
