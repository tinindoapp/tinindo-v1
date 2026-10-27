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

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
export const formatCents = (c: number) => BRL.format(c / 100);
export const formatDateTime = (v: string, timeZone: string) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(v));
/** Data civil "2026-10-20" → "20/10/2026" (sem fuso: é um dia, não um instante). */
export function formatDay(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return day;
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))));
}
/** Recebível "Corte · Ana Beatriz" → serviço e nome para a mensagem pronta (o nome pode faltar). */
export function splitDescription(description: string): { service: string; name: string | null } {
  const i = description.indexOf(" · ");
  if (i < 0) return { service: description, name: null };
  const name = description.slice(i + 3).replace(/\s*\(exemplo\)\s*$/, "").trim();
  return { service: description.slice(0, i).trim(), name: name || null };
}
/** Mensagem pronta para a cliente. Abrir o WhatsApp não significa que ela recebeu. */
export function pixMessage(description: string, amountCents: number, link: string): string {
  const { service, name } = splitDescription(description);
  return `Oi${name ? `, ${name.split(" ")[0]}` : ""}! Segue o Pix de ${service} de ${formatCents(amountCents)}: ${link}`;
}
export const whatsappUrl = (text: string) => `https://wa.me/?text=${encodeURIComponent(text)}`;
/** Cobranças sem confirmação: só aparece quando há alguma. */
export const unknownNote = (n: number) => (n <= 0 ? null : `${n} ${n === 1 ? "cobrança" : "cobranças"} sem confirmação do banco`);
export const todayIn = (timeZone: string, d = new Date()) => d.toLocaleDateString("en-CA", { timeZone });

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
