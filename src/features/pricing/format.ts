// Formatação do módulo de Preços. Centavos inteiros e basis points; nunca float para dinheiro.
const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
export const formatCents = (c: number | null | undefined) => (c === null || c === undefined ? "—" : BRL.format(c / 100));
/** 1500 → "15%"; 1250 → "12,5%". */
export const formatBps = (bps: number) => `${(bps / 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;

/** "15" | "12,5" → basis points. Vazio → 0; inválido → undefined. */
export function parsePercent(raw: string): number | undefined {
  const t = raw.trim().replaceAll("%", "").replaceAll(",", ".");
  if (!t) return 0;
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(t)) return undefined;
  const bps = Math.round(Number(t) * 100);
  return bps <= 10_000 ? bps : undefined;
}

export const WEEKDAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"] as const;

function offsetMin(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(at);
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return Math.round((Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute")) - at.getTime()) / 60_000);
}

/** Início do dia seguinte ao dia civil local (fim exclusivo da validade "até este dia"). */
export function endOfLocalDayExclusive(date: string, timeZone: string): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const guess = new Date(Date.UTC(y, m - 1, d + 1));
  const first = new Date(guess.getTime() - offsetMin(guess, timeZone) * 60_000);
  return new Date(guess.getTime() - offsetMin(first, timeZone) * 60_000).toISOString();
}

export function localDate(value: Date | string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
}

export function formatDate(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone, day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(value));
}
