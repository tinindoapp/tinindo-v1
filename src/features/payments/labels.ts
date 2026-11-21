// Textos do módulo Pagamentos. Estado sempre por palavra; pago ≠ cobrado ≠ enviado.
import type { ChargeStatus } from "@contracts";

export const CHARGE_STATUS: Record<ChargeStatus, string> = {
  creating: "Criando a cobrança",
  pending: "Aguardando pagamento",
  paid: "Pago (confirmado pelo banco)",
  expired: "Expirou",
  cancelled: "Cancelada",
  failed: "Falhou",
  unknown: "Sem resposta do banco (consultando)",
};
export const REFUND_STATUS = { requested: "Estorno pedido", done: "Estornado", failed: "Estorno falhou", unknown: "Estorno sem resposta" } as const;
export const PROVIDER_LABEL = { simulated: "Recebimento simulado (demonstração)", psp: "Pix de verdade (pelo banco)" } as const;
export const DIFF_LABEL: Record<string, string> = {
  paid_without_entry: "O extrato diz pago, mas não há recebimento no caixa",
  entry_without_report: "Há recebimento no caixa que o extrato não mostra",
  amount_mismatch: "Valor no extrato diferente do recebimento",
  unknown_charge: "O extrato mostra uma cobrança que a Tinindo não conhece",
};
export const FAILURE_REASON: Record<string, string> = {
  amount_rejected: "valor recusado pelo banco",
  provider_not_configured: "Pix de verdade ainda não está ligado neste ambiente",
  provider: "o banco informou falha",
};

import { formatCents } from "../../lib/money.ts";
import { deviceTimeZone, formatCivilDate, formatDateTime, formatDayMonth, formatTime, isCivilDate, localDate, now } from "../../lib/time.ts";
export { formatCents, formatDateTime };
/** Data civil "2026-10-20" → "20/10/2026" (sem fuso: é um dia, não um instante).
 *  Data impossível (2026-02-31) não "rola" para março nem passa como se fosse válida (P53, defeito 4). */
export function formatDay(day: string): string {
  if (isCivilDate(day)) return formatCivilDate(day);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? `data inválida (${day})` : day;
}
/** Recebível "Corte · Ana Beatriz" → serviço e nome para a mensagem pronta (o nome pode faltar). */
export function splitDescription(description: string): { service: string; name: string | null } {
  const i = description.indexOf(" · ");
  if (i < 0) return { service: description, name: null };
  const name = description.slice(i + 3).replace(/\s*\(exemplo\)\s*$/, "").trim();
  return { service: description.slice(0, i).trim(), name: name || null };
}
/** Mensagem pronta para a cliente: diz quem manda (05 #8). Abrir o WhatsApp não significa que ela recebeu. */
export function pixMessage(description: string, amountCents: number, link: string, business?: string | null): string {
  const { service, name } = splitDescription(description);
  return `Oi${name ? `, ${name.split(" ")[0]}` : ""}!${business ? ` Aqui é ${business}.` : ""} Segue o Pix de ${service} de ${formatCents(amountCents)}: ${link}`;
}
/** Prazo da cobrança no relógio de quem paga: "Pague até 14:35 de hoje"; em outro dia, com a data. */
export function deadlineText(expiresAt: string, at: Date, timeZone: string = deviceTimeZone()): string {
  const time = formatTime(expiresAt, timeZone);
  if (localDate(expiresAt, timeZone) === localDate(at, timeZone)) return `Pague até ${time} de hoje`;
  return `Pague até ${time} de ${formatDayMonth(expiresAt, timeZone)}`;
}
/** Link que não vale mais: não sugere que foi pago nem manda pagar por outro caminho (05 #11). */
export const missingText = (business?: string | null) =>
  `Ele venceu ou foi cancelado. Não pague por outro caminho sem falar com ${business ?? "quem te cobrou"}: peça um novo link.`;
/** "20/10 às 13:05", no relógio de quem lê. */
export function formatPaidAt(v: string, timeZone: string = deviceTimeZone()): string {
  return `${formatDayMonth(v, timeZone)} às ${formatTime(v, timeZone)}`;
}
/** Cobranças sem confirmação: só aparece quando há alguma. */
export const unknownNote = (n: number) => (n <= 0 ? null : `${n} ${n === 1 ? "cobrança" : "cobranças"} sem confirmação do banco`);
export const todayIn = (timeZone: string, d: Date = now()) => localDate(d, timeZone);

export function explain(err: unknown): string {
  const e = err as { code?: string; field?: string } | null;
  switch (e?.code) {
    case "POLICY_REJECTED":
      if (e.field === "charge") return "Já existe uma cobrança aguardando pagamento para este recebível.";
      if (e.field === "status") return "Esta cobrança não está em um estado que permita isso.";
      if (e.field === "refund" || e.field === "reversed") return "Esta cobrança já tem estorno pedido ou concluído.";
      if (e.field === "provider") return "O simulador só funciona com cobranças simuladas.";
      return "As regras não permitem esta ação agora. Nada foi alterado.";
    case "PROVIDER_UNAVAILABLE":
      return "O banco não respondeu ou o Pix de verdade ainda não está ligado. Nada foi presumido: confira o estado da cobrança.";
    case "STALE_VERSION":
      return "A cobrança mudou. Atualizamos a tela: confira o estado atual.";
    case "VALIDATION_ERROR":
      return "Confira os campos. Nada foi gravado.";
    case "NOT_FOUND":
      return "Não encontrado. O link pode estar errado ou a cobrança foi removida.";
    case "FORBIDDEN":
      return "Só o dono do negócio acessa as cobranças.";
    default:
      return "Não foi possível concluir agora. Tentar de novo é seguro.";
  }
}
