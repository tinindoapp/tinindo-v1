// Datas e contas do Caixa. Centavos inteiros, nunca float. Funções puras (money.test.ts).
// Ler e escrever dinheiro é do app inteiro (src/lib/money.ts); reexportado aqui para as telas do Caixa.
export { centsToInput, formatCents, parseBRL } from "../../lib/money.ts";

/** Data civil (YYYY-MM-DD) do instante no fuso do negócio. */
export function localDate(value: Date | string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(value),
  );
}

export function formatDate(value: string | Date, timeZone: string): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone, day: "2-digit", month: "2-digit", year: "numeric" }).format(
    new Date(value),
  );
}

/** Deslocamento (min) do fuso no instante dado. */
function offsetMin(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(at);
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"));
  return Math.round((asUtc - at.getTime()) / 60_000);
}

/** Meia-noite local de uma data civil, como instante ISO (UTC). */
export function startOfLocalDay(date: string, timeZone: string): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const guess = new Date(Date.UTC(y, m - 1, d));
  const first = new Date(guess.getTime() - offsetMin(guess, timeZone) * 60_000);
  return new Date(guess.getTime() - offsetMin(first, timeZone) * 60_000).toISOString();
}

/** Meio-dia local de uma data civil (data informada pelo usuário para recebimento/despesa). */
export function noonOfLocalDay(date: string, timeZone: string): string {
  return new Date(Date.parse(startOfLocalDay(date, timeZone)) + 12 * 3_600_000).toISOString();
}

/** Último segundo do dia civil local (validade "até o fim do dia"). */
export function endOfLocalDay(date: string, timeZone: string): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const next = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  return new Date(Date.parse(startOfLocalDay(next, timeZone)) - 1000).toISOString();
}

/** Mês local [1º dia 00:00, 1º dia do mês seguinte 00:00) no fuso do negócio. */
export function monthPeriod(month: string, timeZone: string): { starts_at: string; ends_at: string } {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  return { starts_at: startOfLocalDay(`${month}-01`, timeZone), ends_at: startOfLocalDay(`${next}-01`, timeZone) };
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const idx = y * 12 + (m - 1) + delta;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}

export function formatMonth(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 15)));
}

/** "outubro de 2026" → "Outubro de 2026": só a primeira letra (o "de" continua minúsculo). */
export function capitalizeFirst(text: string): string {
  return text ? text.charAt(0).toLocaleUpperCase("pt-BR") + text.slice(1) : text;
}

/** O que sobrou no mês = recebido − gasto (registrados). Pode ser negativo; não é lucro nem saldo do banco. */
export function leftover(receivedCents: number, spentCents: number): { cents: number; label: string } {
  const cents = receivedCents - spentCents;
  return { cents, label: cents < 0 ? "Faltou no mês" : "Sobrou no mês" };
}

/** Soma dos atendimentos concluídos sem cobrança (os sem preço combinado não somam). */
export function unchargedTotal(list: { agreed_price_cents: number | null }[]): number {
  return list.reduce((sum, b) => sum + (b.agreed_price_cents ?? 0), 0);
}
