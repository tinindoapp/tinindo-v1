// Datas e contas do Caixa. Centavos inteiros, nunca float. Funções puras (money.test.ts).
// Ler e escrever dinheiro é do app inteiro (src/lib/money.ts); reexportado aqui para as telas do Caixa.
export { centsToInput, formatCents, parseBRL } from "../../lib/money.ts";

// Datas no fuso do negócio também são do app inteiro (src/lib/time.ts); reexportadas com os nomes que o Caixa usa.
import { startOfLocalDay, startOfNextLocalDay } from "../../lib/time.ts";
export { formatDate, formatMonth, localDate, noonOfLocalDay, startOfLocalDay } from "../../lib/time.ts";

/**
 * Último segundo do dia civil local (validade "até o fim do dia"): um segundo antes da meia-noite seguinte.
 * Não é o `endOfLocalDay` da lib: em fuso que muda de horário à meia-noite os dois diferem em uma hora.
 */
export function endOfLocalDay(date: string, timeZone: string): string {
  return new Date(Date.parse(startOfNextLocalDay(date, timeZone)) - 1000).toISOString();
}

/** Mês local [1º dia 00:00, 1º dia do mês seguinte 00:00) no fuso do negócio. */
export function monthPeriod(month: string, timeZone: string): { starts_at: string; ends_at: string } {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  return { starts_at: startOfLocalDay(`${month}-01`, timeZone), ends_at: startOfLocalDay(`${next}-01`, timeZone) };
}

/**
 * Período das pendências: atendimento concluído sem cobrança não tem mês. Vai do mesmo dia um ano atrás até o fim de
 * hoje, no fuso do negócio (no máximo 367 dias; o servidor aceita até 400). O seletor de mês do Caixa não o muda.
 */
export function pendingPeriod(today: string, timeZone: string): { starts_at: string; ends_at: string } {
  const [y, m, d] = today.split("-").map(Number) as [number, number, number];
  const yearAgo = new Date(Date.UTC(y - 1, m - 1, m === 2 && d === 29 ? 28 : d)).toISOString().slice(0, 10);
  const tomorrow = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  return { starts_at: startOfLocalDay(yearAgo, timeZone), ends_at: startOfLocalDay(tomorrow, timeZone) };
}

/** Pendências do mais novo ao mais antigo: o atendimento de hoje fica no topo. */
export function newestFirst<T extends { starts_at: string }>(list: T[]): T[] {
  return [...list].sort((a, b) => Date.parse(b.starts_at) - Date.parse(a.starts_at));
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const idx = y * 12 + (m - 1) + delta;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
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
