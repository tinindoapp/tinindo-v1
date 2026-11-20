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

/** O aparelho está num fuso com outro horário que o do negócio naquele instante (só então vale avisar). */
export function deviceZoneDiffers(value: Date | string, timeZone: string): boolean {
  const instant = toDate(value);
  return -instant.getTimezoneOffset() !== offsetMinutes(instant, timeZone);
}

/**
 * Nome amigável do fuso para a frase "Horários de Brasília": usa o nome que o navegador dá ao fuso em português
 * ("Horário Padrão de Brasília" → "de Brasília"). Sem nome conhecido, cai no identificador legível.
 */
export function friendlyZone(value: Date | string, timeZone: string): string {
  let name: string;
  try {
    name =
      new Intl.DateTimeFormat("pt-BR", { timeZone, timeZoneName: "longGeneric" })
        .formatToParts(toDate(value))
        .find((p) => p.type === "timeZoneName")?.value ?? "";
  } catch {
    name = "";
  }
  const m = /^Horário(?: Padrão)? (d[aeo]s? .+)$/.exec(name);
  if (m) return m[1]!;
  const city = timeZone.split("/").pop()?.replaceAll("_", " ") ?? timeZone;
  return `do fuso de ${city}`;
}

/** "Seg 19": dia da semana curto, sem ponto, e o dia do mês (cabe numa linha na visão Semana). */
export function formatWeekdayDay(date: CivilDate): string {
  const wd = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", weekday: "short" }).format(civilToDate(date)).replace(".", "");
  return `${wd.charAt(0).toUpperCase()}${wd.slice(1)} ${Number(date.slice(8, 10))}`;
}

/**
 * Períodos do "recebido" no Caixa e na Hoje (P48): hoje, a semana (de segunda até o fim de hoje) e o mês, em janelas
 * semiabertas no fuso do negócio. O contrato `finance.summary` aceita qualquer período: a semana sai de uma chamada a mais,
 * sem campo novo no contrato.
 */
export function receivedPeriods(today: CivilDate, timeZone: string) {
  const day = dayWindow(today, timeZone);
  const monday = weekStart(today);
  const first = `${today.slice(0, 7)}-01`;
  const [y, m] = nums(first, "-");
  const nextMonth = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  return {
    day,
    week: { starts_at: dayWindow(monday, timeZone).starts_at, ends_at: day.ends_at },
    /** Segunda-feira da semana, para escrever o período ("de 19/10 a 20/10"). */
    weekFrom: monday,
    month: { starts_at: dayWindow(first, timeZone).starts_at, ends_at: dayWindow(nextMonth, timeZone).starts_at },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Relógio e formatos comuns das telas. Tela não chama `new Date()` solto (regra de lint): "agora" vem de `now()`,
// e a data de hoje, de `today(fuso)`. Com um relógio só, o teste consegue fazer o tempo andar.

let clock: () => Date = () => new Date();

/** Instante atual. Único `new Date()` sem argumento que as telas usam. */
export function now(): Date {
  return clock();
}

/** Só para teste: troca o relógio e devolve a função que restaura o real. */
export function setClockForTest(fake: () => Date): () => void {
  const previous = clock;
  clock = fake;
  return () => {
    clock = previous;
  };
}

/** Data civil (YYYY-MM-DD) de um instante, no fuso do negócio. */
export function localDate(value: Date | string | number, timeZone: string): CivilDate {
  const p = rawParts(toDate(value), timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}

/** Hoje (YYYY-MM-DD) no fuso do negócio. */
export function today(timeZone: string): CivilDate {
  return localDate(now(), timeZone);
}

/** Meia-noite local de uma data civil, como instante ISO em UTC ("…Z"). */
export function startOfLocalDay(date: CivilDate, timeZone: string): string {
  return zonedInstant(date, "00:00", timeZone).toISOString();
}

/** Meia-noite local do dia seguinte: fim exclusivo de "até este dia", como instante ISO em UTC. */
export function startOfNextLocalDay(date: CivilDate, timeZone: string): string {
  return startOfLocalDay(addDays(date, 1), timeZone);
}

/** Meio-dia local de uma data civil (data informada pela pessoa, sem hora), como instante ISO em UTC. */
export function noonOfLocalDay(date: CivilDate, timeZone: string): string {
  return new Date(Date.parse(startOfLocalDay(date, timeZone)) + 12 * 3_600_000).toISOString();
}

/** 23:59:59 local de uma data civil (validade "até este dia", inclusive), como instante ISO em UTC. */
export function endOfLocalDay(date: CivilDate, timeZone: string): string {
  return new Date(zonedInstant(date, "23:59", timeZone).getTime() + 59_000).toISOString();
}

/** Data e hora civis no fuso do negócio → instante ISO em UTC. */
export function localToIso(date: CivilDate, time: string, timeZone: string): string {
  return zonedInstant(date, time, timeZone).toISOString();
}

const formatCache = new Map<string, Intl.DateTimeFormat>();
function fmt(timeZone: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${timeZone}|${JSON.stringify(options)}`;
  let f = formatCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat("pt-BR", { timeZone, ...options });
    formatCache.set(key, f);
  }
  return f;
}

/** "20/10/2026" */
export function formatDate(value: Date | string, timeZone: string): string {
  return fmt(timeZone, { day: "2-digit", month: "2-digit", year: "numeric" }).format(toDate(value));
}

/** "20/10/2026, 09:30": data com ano e hora (`dateStyle` e `timeStyle` curtos). */
export function formatFullDateTime(value: Date | string, timeZone: string): string {
  return fmt(timeZone, { dateStyle: "short", timeStyle: "short" }).format(toDate(value));
}

/** "20/10" */
export function formatDayMonth(value: Date | string, timeZone: string): string {
  return fmt(timeZone, { day: "2-digit", month: "2-digit" }).format(toDate(value));
}

/** "20/10, 09:30" */
export function formatDateTime(value: Date | string, timeZone: string): string {
  return fmt(timeZone, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(toDate(value));
}

/** "ter., 20/10" a partir de um instante (para data civil, use `formatDayShort`). */
export function formatWeekdayDate(value: Date | string, timeZone: string): string {
  return fmt(timeZone, { weekday: "short", day: "2-digit", month: "2-digit" }).format(toDate(value));
}

/** "ter., 20/10, 09:30" */
export function formatWeekdayDateTime(value: Date | string, timeZone: string): string {
  return fmt(timeZone, { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(toDate(value));
}

/** "terça-feira, 20/10" */
export function formatWeekdayLongDate(value: Date | string, timeZone: string): string {
  return fmt(timeZone, { weekday: "long", day: "2-digit", month: "2-digit" }).format(toDate(value));
}

/** "terça-feira, 20/10, 09:00–09:30" */
export function formatSlot(slot: { starts_at: string; ends_at: string }, timeZone: string): string {
  return `${formatWeekdayLongDate(slot.starts_at, timeZone)}, ${formatTime(slot.starts_at, timeZone)}–${formatTime(slot.ends_at, timeZone)}`;
}

/** "terça-feira, 20/10, às 09:00" */
export function formatStart(value: Date | string, timeZone: string): string {
  return `${formatWeekdayLongDate(value, timeZone)}, às ${formatTime(value, timeZone)}`;
}

/** Data civil "2026-10-20" → "ter 20/10": dia da semana curto, sem ponto, e dia/mês (chip de dia). */
export function formatWeekdayDayMonth(date: CivilDate): string {
  const wd = fmt("UTC", { weekday: "short" }).format(civilToDate(date)).replace(".", "");
  return `${wd} ${date.slice(8, 10)}/${date.slice(5, 7)}`;
}

/** Data civil "2026-10-20" → "20/10/2026", sem passar por fuso. */
export function formatCivilDate(date: CivilDate): string {
  return `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;
}

/** Mês "2026-10" (ou data "2026-10-20") → "outubro de 2026". */
export function formatMonth(month: string): string {
  const [y, m] = nums(month, "-");
  return fmt("UTC", { month: "long", year: "numeric" }).format(new Date(Date.UTC(y, m - 1, 15)));
}
