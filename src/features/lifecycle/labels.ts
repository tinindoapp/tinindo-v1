// Textos do módulo Relacionamento. Estado sempre por palavra: enviado ao canal ≠ entregue; compartilhado ≠ entregue.
import type { LifecycleRule, LifecycleStepStatus } from "@contracts";

export const RULE_LABEL: Record<LifecycleRule, string> = {
  confirmation: "Confirmação do agendamento",
  reminder: "Lembrete do agendamento",
  quote_followup: "Acompanhamento do orçamento",
  receivable_reminder: "Lembrete de cobrança",
  reactivation: "Reativação (campanha)",
};
export const STEP_STATUS: Record<LifecycleStepStatus, string> = {
  scheduled: "Agendado",
  deferred: "Adiado (teto diário)",
  sent: "Enviado ao canal",
  manual: "Para você compartilhar",
  shared: "Compartilhado por você",
  skipped: "Pulado",
  cancelled: "Cancelado",
};
export const SKIP_REASON: Record<string, string> = {
  opted_out: "a cliente pediu para não receber",
  consent_revoked: "consentimento revogado",
  no_marketing_consent: "sem consentimento para marketing",
  no_customer: "sem cliente vinculada",
  rescheduled: "atendimento remarcado",
  cancelled: "atendimento cancelado",
  completed: "atendimento concluído",
  accepted: "orçamento aceito",
  declined: "orçamento recusado",
  paid: "pago",
  owner: "cancelado por você",
  daily_budget: "teto diário atingido",
  booking_not_confirmed: "atendimento não está confirmado",
  quote_decided: "orçamento já decidido",
  receivable_closed: "cobrança encerrada",
  template_not_approved: "modelo não aprovado no provedor",
};
export const MESSAGE_STATUS: Record<string, string> = {
  queued: "na fila", sending: "enviando", sent: "enviada", delivered: "entregue", read: "lida", failed: "falhou", delivery_unknown: "entrega desconhecida",
};

export const formatDateTime = (v: string, timeZone: string) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(v));
export const formatDate = (v: string, timeZone: string) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone, day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(v));

export function explain(err: unknown): string {
  const e = err as { code?: string; field?: string } | null;
  switch (e?.code) {
    case "STALE_VERSION":
      if (e.field === "audience_hash") return "O público mudou desde que você viu. Atualizamos a lista: confira antes de aprovar.";
      return "A configuração mudou em outro lugar. Atualizamos a tela: confira e tente de novo.";
    case "POLICY_REJECTED":
      if (e.field === "audience") return "Ninguém elegível agora: só clientes com consentimento de marketing e sem visita no prazo entram.";
      if (e.field === "status") return "Este passo não está em um estado que permita isso.";
      return "As regras não permitem esta ação agora. Nada foi alterado.";
    case "VALIDATION_ERROR":
      if (e.field === "settings") return "Valores fora do permitido (horas 1–48, dias 1–14, reativação 14–365, teto 0–500).";
      return "Confira os campos. Nada foi gravado.";
    case "NOT_FOUND":
      return "Não encontrado. A tela pode estar desatualizada.";
    case "FORBIDDEN":
      return "Só o dono do negócio acessa o relacionamento.";
    default:
      return "Não foi possível concluir agora. Tentar de novo é seguro.";
  }
}
