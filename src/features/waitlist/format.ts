// Formatação da Lista de espera: tudo no fuso do negócio, nunca no do navegador.
export { formatCents } from "../../lib/money.ts";
// Datas: os formatadores comuns moram em src/lib/time.ts.
export { endOfLocalDay, formatDateTime, formatSlot, formatStart, localDate } from "../../lib/time.ts";
export const WEEKDAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"] as const;

export function windowsText(w: { weekday: number; local_start: string; local_end: string }[] = []): string {
  return w.map((x) => `${WEEKDAYS[x.weekday]} ${x.local_start}–${x.local_end}`).join(", ");
}

/** Dia da semana (0 = domingo) e hora "HH:MM" de um instante, no fuso do negócio. */
export function localWeekdayTime(v: string, timeZone: string): { weekday: number; time: string } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", weekday: "short", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(v));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday")), time: `${get("hour")}:${get("minute")}` };
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
