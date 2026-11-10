// Regras e formatação dos Orçamentos, puras e testadas. Tudo no fuso do negócio; dinheiro em centavos inteiros.
import type { SalesQuoteStatus } from "@contracts";

// Ler e escrever dinheiro é do app inteiro (src/lib/money.ts): vazio → null, inválido → undefined.
export { centsToInput, formatCents, parseBRL } from "../../lib/money.ts";

export const lineTotal = (i: { quantity: number; unit_price_cents: number }) => i.quantity * i.unit_price_cents;
export const quoteTotal = (items: { quantity: number; unit_price_cents: number }[]) => items.reduce((s, i) => s + lineTotal(i), 0);

/** Igual ao banco: 'sent' com validade vencida aparece como 'expired'. */
export function effectiveStatus(status: SalesQuoteStatus, validUntil: string, now: Date): SalesQuoteStatus {
  return status === "sent" && Date.parse(validUntil) <= now.getTime() ? "expired" : status;
}

export const STATUS_LABEL: Record<SalesQuoteStatus, string> = {
  draft: "Rascunho", sent: "Enviado, aguardando o cliente", accepted: "Aceito", declined: "Recusado",
  expired: "Vencido", cancelled: "Cancelado",
};

export function formatDateTime(v: string, timeZone: string): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(v));
}
export function formatSlot(slot: { starts_at: string; ends_at: string }, timeZone: string): string {
  const day = new Intl.DateTimeFormat("pt-BR", { timeZone, weekday: "long", day: "2-digit", month: "2-digit" }).format(new Date(slot.starts_at));
  const t = (v: string) => new Intl.DateTimeFormat("pt-BR", { timeZone, hour: "2-digit", minute: "2-digit" }).format(new Date(v));
  return `${day}, ${t(slot.starts_at)}–${t(slot.ends_at)}`;
}
export function localDate(value: Date | string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
}

/** Data + hora civis no fuso do negócio → instante ISO (UTC). */
export function localToIso(date: string, time: string, timeZone: string): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const [hh, mm] = time.split(":").map(Number) as [number, number];
  const guess = new Date(Date.UTC(y, m - 1, d, hh, mm));
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit" }).formatToParts(guess);
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const offset = Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute")) - guess.getTime();
  return new Date(guess.getTime() - offset).toISOString();
}

/** Validade "por N dias": fim do dia civil local daqui a N dias. */
export function validUntilInDays(now: Date, days: number, timeZone: string): string {
  const day = localDate(new Date(now.getTime() + days * 86_400_000), timeZone);
  return new Date(Date.parse(localToIso(day, "23:59", timeZone)) + 59_000).toISOString();
}

/** Explica erros do contrato sem jargão e diz o que NÃO aconteceu. */
export function explain(err: unknown): string {
  const e = err as { code?: string; field?: string } | null;
  switch (e?.code) {
    case "SLOT_CONFLICT":
      return "O horário proposto não está livre (ocupado, bloqueado ou fora do expediente). Nada foi gravado.";
    case "STALE_VERSION":
      return "Este orçamento mudou em outro lugar. Atualizamos a lista: confira a versão atual.";
    case "POLICY_REJECTED":
      if (e.field === "valid_until") return "O orçamento venceu. Revise com uma nova validade antes de gerar outro link.";
      return "Este orçamento já foi decidido ou cancelado. Nada foi alterado.";
    case "VALIDATION_ERROR":
      if (e.field === "slot") return "O horário precisa ser futuro e de um serviço que está nos itens.";
      if (e.field === "valid_until") return "A validade precisa ser futura e de no máximo 90 dias.";
      return "Confira os campos. Nada foi gravado.";
    case "NOT_FOUND":
      return "Cliente ou serviço não encontrado neste negócio. Nada foi gravado.";
    case "IDEMPOTENCY_MISMATCH":
      return "Pedido repetido com dados diferentes. Nada novo foi gravado.";
    case "FORBIDDEN":
      return "Só o dono do negócio gerencia orçamentos.";
    default:
      return "Não foi possível concluir agora. Tentar de novo é seguro.";
  }
}
