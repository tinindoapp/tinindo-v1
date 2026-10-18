// Textos e regras de apresentação do módulo Plano e serviços. Dinheiro em centavos; datas no fuso do negócio.
import type { AccessScope, ServiceOrderStatus } from "@contracts";

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
export const formatCents = (c: number) => BRL.format(c / 100);
export const formatDateTime = (v: string, timeZone: string) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(v));
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

export function explain(err: unknown): string {
  const e = err as { code?: string; field?: string } | null;
  switch (e?.code) {
    case "STALE_VERSION":
      return "O catálogo ou o pedido mudou. Atualizamos a tela: confira a versão atual antes de confirmar.";
    case "QUOTA_EXCEEDED":
      return "Isso passa da franquia de minutos do pedido. Nada foi registrado.";
    case "POLICY_REJECTED":
      if (e.field === "access") return "Sem acesso concedido pelo cliente: não dá para começar.";
      if (e.field === "offering_version_id") return "Você já está neste plano.";
      return "As regras não permitem esta ação agora. Nada foi alterado.";
    case "VALIDATION_ERROR":
      if (e.field === "expires_at") return "O acesso precisa vencer em até 30 dias.";
      return "Confira os campos. Nada foi gravado.";
    case "FORBIDDEN":
      return "Você não tem permissão para isso.";
    default:
      return "Não foi possível concluir agora. Tentar de novo é seguro.";
  }
}
