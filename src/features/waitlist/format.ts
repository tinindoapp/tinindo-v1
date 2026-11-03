// Formatação da Lista de espera: tudo no fuso do negócio, nunca no do navegador.
const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
export const formatCents = (c: number) => BRL.format(c / 100);
export const WEEKDAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"] as const;

export function formatSlot(slot: { starts_at: string; ends_at: string }, timeZone: string): string {
  const day = new Intl.DateTimeFormat("pt-BR", { timeZone, weekday: "long", day: "2-digit", month: "2-digit" }).format(new Date(slot.starts_at));
  const t = (v: string) => new Intl.DateTimeFormat("pt-BR", { timeZone, hour: "2-digit", minute: "2-digit" }).format(new Date(v));
  return `${day}, ${t(slot.starts_at)}–${t(slot.ends_at)}`;
}

export function formatDateTime(v: string, timeZone: string): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(v));
}

export function localDate(value: Date | string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
}

/** Fim do dia civil local, como instante ISO (validade "até este dia"). */
export function endOfLocalDay(date: string, timeZone: string): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const guess = new Date(Date.UTC(y, m - 1, d, 23, 59, 59));
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(guess);
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const offset = Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second")) - guess.getTime();
  return new Date(guess.getTime() - offset).toISOString();
}

export function windowsText(w: { weekday: number; local_start: string; local_end: string }[] = []): string {
  return w.map((x) => `${WEEKDAYS[x.weekday]} ${x.local_start}–${x.local_end}`).join(", ");
}

/** Dia da semana (0 = domingo) e hora "HH:MM" de um instante, no fuso do negócio. */
export function localWeekdayTime(v: string, timeZone: string): { weekday: number; time: string } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", weekday: "short", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(v));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday")), time: `${get("hour")}:${get("minute")}` };
}

/** "quarta-feira, 21/10, às 11:00" (o horário escrito por extenso quando ninguém da lista aceita). */
export function formatStart(v: string, timeZone: string): string {
  const day = new Intl.DateTimeFormat("pt-BR", { timeZone, weekday: "long", day: "2-digit", month: "2-digit" }).format(new Date(v));
  const time = new Intl.DateTimeFormat("pt-BR", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(v));
  return `${day}, às ${time}`;
}

/**
 * Entradas que aceitam um horário que começa em `startsAt`: ativa, válida depois do início e com faixa semanal que cobre o
 * início, na ordem da fila. É a mesma conta do servidor ao criar candidatos (app.wl_candidates_for); serve para mostrar a
 * vaga que chegou pela URL antes de o servidor gerar os candidatos dela.
 */
export function entriesForStart<E extends { status: string; valid_until: string; joined_at?: string; id: string; acceptable_windows?: { weekday: number; local_start: string; local_end: string }[] }>(
  entries: E[],
  startsAt: string,
  timeZone: string,
): E[] {
  const start = Date.parse(startsAt);
  const local = localWeekdayTime(startsAt, timeZone);
  return entries
    .filter(
      (e) =>
        e.status === "active" &&
        Date.parse(e.valid_until) > start &&
        (e.acceptable_windows ?? []).some((w) => w.weekday === local.weekday && local.time >= w.local_start && local.time < w.local_end),
    )
    .sort((a, b) => (a.joined_at ?? "").localeCompare(b.joined_at ?? "") || a.id.localeCompare(b.id));
}
