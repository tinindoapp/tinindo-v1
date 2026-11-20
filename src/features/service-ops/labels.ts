// Textos e regras de apresentação do módulo Plano e serviços. Dinheiro em centavos; datas no fuso do negócio.
import type { AccessScope, ServiceOrderStatus } from "@contracts";

import { errorExplainer } from "../../lib/errors.ts";
import { formatCents } from "../../lib/money.ts";
export { formatCents };
export const priceLabel = (cents: number, billing: "monthly" | "one_time") =>
  cents === 0 ? "Grátis" : `${formatCents(cents)}${billing === "monthly" ? "/mês" : " (uma vez)"}`;

export const ORDER_STATUS: Record<ServiceOrderStatus, string> = {
  scope_accepted: "Escopo aceito, aguardando a equipe",
  awaiting_access: "Aguardando seu acesso",
  in_progress: "Em execução",
  client_review: "Aguardando sua revisão",
  delivered: "Entregue",
  cancelled: "Cancelado",
  blocked: "Bloqueado",
};
export const SCOPE_LABEL: Record<AccessScope, string> = {
  catalog: "Serviços e preços",
  agenda: "Agenda (próximos 14 dias, sem nomes)",
  customers: "Nomes dos clientes (sem telefone nem e-mail)",
};
export const ACTION_LABEL: Record<string, string> = {
  "access.grant": "Acesso concedido",
  "access.revoke": "Acesso revogado",
  "access.read": "Leitura com acesso delegado",
  "ops.start": "Execução iniciada",
  "ops.log_work": "Minutos registrados",
  "ops.deliver": "Entrega enviada",
  "ops.block": "Pedido bloqueado",
};

/** Minutos usados em relação à franquia, em texto (nunca só barra/cor). */
export const minutesText = (used: number, quota: number) => `${used} de ${quota} min medidos`;

export const explain = errorExplainer({
  STALE_VERSION: "O catálogo ou o pedido mudou. Atualizamos a tela: confira a versão atual antes de confirmar.",
  QUOTA_EXCEEDED: "Isso passa da franquia de minutos do pedido. Nada foi registrado.",
  "POLICY_REJECTED.access": "Sem acesso concedido pelo cliente: não dá para começar.",
  "POLICY_REJECTED.offering_version_id": "Você já está neste plano.",
  POLICY_REJECTED: "As regras não permitem esta ação agora. Nada foi alterado.",
  "VALIDATION_ERROR.expires_at": "O acesso precisa vencer em até 30 dias.",
  VALIDATION_ERROR: "Confira os campos. Nada foi gravado.",
  FORBIDDEN: "Você não tem permissão para isso.",
});
