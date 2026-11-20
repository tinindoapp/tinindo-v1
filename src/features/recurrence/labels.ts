// Textos do módulo Assinaturas. Dinheiro em centavos; datas no fuso do negócio; estado por palavra.
import type { Receivable } from "@contracts";
import { errorExplainer } from "../../lib/errors.ts";

export { formatCents } from "../../lib/money.ts";
export const cycleLabel = (days: number) => (days === 7 ? "por semana" : days === 14 ? "a cada 2 semanas" : "por mês");
export const RECEIVABLE_STATUS: Record<Receivable["status"], string> = {
  open: "cobrança em aberto", partially_paid: "recebido em parte", paid: "pago", cancelled: "cobrança cancelada",
};

export const explain = errorExplainer({
  STALE_VERSION: "Isto mudou em outro lugar. Atualizamos a tela: confira e tente de novo.",
  "POLICY_REJECTED.subscription": "Esta cliente já assina este plano.",
  "POLICY_REJECTED.plan_id": "Este plano está inativo: reative-o antes de aceitar adesões.",
  "POLICY_REJECTED.status": "Esta assinatura não está em um estado que permita isso.",
  POLICY_REJECTED: "As regras não permitem esta ação agora. Nada foi alterado.",
  VALIDATION_ERROR: "Confira os campos: sessões 1–31, ciclo 7/14/30 dias, preço maior que zero.",
  NOT_FOUND: "Não encontrado. A tela pode estar desatualizada.",
  FORBIDDEN: "Só o dono do negócio acessa as assinaturas.",
});
