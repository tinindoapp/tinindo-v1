// Regras e formatação dos Orçamentos, puras e testadas. Tudo no fuso do negócio; dinheiro em centavos inteiros.
import type { SalesQuoteStatus } from "@contracts";
import { errorExplainer } from "../../lib/errors.ts";
import { localDate, localToIso } from "../../lib/time.ts";

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

// Datas no fuso do negócio: do app inteiro (src/lib/time.ts).
export { formatDateTime, formatSlot, localDate, localToIso } from "../../lib/time.ts";
/** Validade "por N dias": fim do dia civil local daqui a N dias. */
export function validUntilInDays(now: Date, days: number, timeZone: string): string {
  const day = localDate(new Date(now.getTime() + days * 86_400_000), timeZone);
  return new Date(Date.parse(localToIso(day, "23:59", timeZone)) + 59_000).toISOString();
}

/** Explica erros do contrato sem jargão e diz o que NÃO aconteceu. */
export const explain = errorExplainer({
  SLOT_CONFLICT: "O horário proposto não está livre (ocupado, bloqueado ou fora do expediente). Nada foi gravado.",
  STALE_VERSION: "Este orçamento mudou em outro lugar. Atualizamos a lista: confira a versão atual.",
  "POLICY_REJECTED.valid_until": "O orçamento venceu. Revise com uma nova validade antes de gerar outro link.",
  POLICY_REJECTED: "Este orçamento já foi decidido ou cancelado. Nada foi alterado.",
  "VALIDATION_ERROR.slot": "O horário precisa ser futuro e de um serviço que está nos itens.",
  "VALIDATION_ERROR.valid_until": "A validade precisa ser futura e de no máximo 90 dias.",
  VALIDATION_ERROR: "Confira os campos. Nada foi gravado.",
  NOT_FOUND: "Cliente ou serviço não encontrado neste negócio. Nada foi gravado.",
  IDEMPOTENCY_MISMATCH: "Pedido repetido com dados diferentes. Nada novo foi gravado.",
  FORBIDDEN: "Só o dono do negócio gerencia orçamentos.",
});
