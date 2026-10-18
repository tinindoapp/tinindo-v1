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
