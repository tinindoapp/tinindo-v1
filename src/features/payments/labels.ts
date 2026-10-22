// Textos do módulo Pagamentos. Estado sempre por palavra; pago ≠ cobrado ≠ enviado.
import type { ChargeStatus } from "@contracts";

export const CHARGE_STATUS: Record<ChargeStatus, string> = {
  creating: "Criando no provedor",
  pending: "Aguardando pagamento",
  paid: "Pago (confirmado pelo provedor)",
  expired: "Expirou",
  cancelled: "Cancelada",
  failed: "Falhou",
  unknown: "Sem resposta do provedor (consultando)",
};
export const REFUND_STATUS = { requested: "Estorno pedido", done: "Estornado", failed: "Estorno falhou", unknown: "Estorno sem resposta" } as const;
export const PROVIDER_LABEL = { simulated: "PSP simulado (sem dinheiro real)", psp: "PSP real (Pix)" } as const;
export const DIFF_LABEL: Record<string, string> = {
  paid_without_entry: "O provedor diz pago, mas não há recebimento no caixa",
  entry_without_report: "Há recebimento no caixa que o provedor não lista",
  amount_mismatch: "Valor no provedor diferente do recebimento",
  unknown_charge: "O provedor lista uma cobrança que o sistema não conhece",
};
export const FAILURE_REASON: Record<string, string> = {
  amount_rejected: "valor recusado pelo provedor",
  provider_not_configured: "provedor não configurado neste ambiente",
  provider: "o provedor informou falha",
};

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
export const formatCents = (c: number) => BRL.format(c / 100);
export const formatDateTime = (v: string, timeZone: string) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(v));
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
      return "O provedor de pagamento não respondeu ou não está configurado. Nada foi presumido: confira o estado da cobrança.";
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
