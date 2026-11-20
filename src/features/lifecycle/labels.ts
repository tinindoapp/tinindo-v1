// Textos do módulo Relacionamento. Estado sempre por palavra: enviado ao canal ≠ entregue; compartilhado ≠ entregue.
import type { LifecycleRule, LifecycleStepStatus } from "@contracts";
import { errorExplainer } from "../../lib/errors.ts";

export const RULE_LABEL: Record<LifecycleRule, string> = {
  confirmation: "Confirmação do agendamento",
  reminder: "Lembrete do agendamento",
  quote_followup: "Acompanhamento do orçamento",
  receivable_reminder: "Lembrete de cobrança",
  reactivation: "Reativação (campanha)",
  package_expiry: "Aviso de pacote perto de vencer",
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

export const explain = errorExplainer({
  "STALE_VERSION.audience_hash": "O público mudou desde que você viu. Atualizamos a lista: confira antes de aprovar.",
  STALE_VERSION: "A configuração mudou em outro lugar. Atualizamos a tela: confira e tente de novo.",
  "POLICY_REJECTED.audience": "Ninguém elegível agora: só clientes com consentimento de marketing e sem visita no prazo entram.",
  "POLICY_REJECTED.status": "Este passo não está em um estado que permita isso.",
  POLICY_REJECTED: "As regras não permitem esta ação agora. Nada foi alterado.",
  "VALIDATION_ERROR.settings": "Valores fora do permitido (horas 1–48, dias 1–14, reativação 14–365, teto 0–500).",
  VALIDATION_ERROR: "Confira os campos. Nada foi gravado.",
  NOT_FOUND: "Não encontrado. A tela pode estar desatualizada.",
  FORBIDDEN: "Só o dono do negócio acessa o relacionamento.",
});
