// Textos do módulo Assinaturas. Dinheiro em centavos; datas no fuso do negócio; estado por palavra.
import type { Receivable } from "@contracts";

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
export const formatCents = (c: number) => BRL.format(c / 100);
export const formatDate = (v: string, timeZone: string) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone, day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(v));
export const cycleLabel = (days: number) => (days === 7 ? "por semana" : days === 14 ? "a cada 2 semanas" : "por mês");
export const RECEIVABLE_STATUS: Record<Receivable["status"], string> = {
  open: "cobrança em aberto", partially_paid: "recebido em parte", paid: "pago", cancelled: "cobrança cancelada",
};

export function explain(err: unknown): string {
  const e = err as { code?: string; field?: string } | null;
  switch (e?.code) {
    case "STALE_VERSION":
      return "Isto mudou em outro lugar. Atualizamos a tela: confira e tente de novo.";
    case "POLICY_REJECTED":
      if (e.field === "subscription") return "Esta cliente já assina este plano.";
      if (e.field === "plan_id") return "Este plano está inativo: reative-o antes de aceitar adesões.";
      if (e.field === "status") return "Esta assinatura não está em um estado que permita isso.";
      return "As regras não permitem esta ação agora. Nada foi alterado.";
    case "VALIDATION_ERROR":
      return "Confira os campos: sessões 1–31, ciclo 7/14/30 dias, preço maior que zero.";
    case "NOT_FOUND":
      return "Não encontrado. A tela pode estar desatualizada.";
    case "FORBIDDEN":
      return "Só o dono do negócio acessa as assinaturas.";
    default:
      return "Não foi possível concluir agora. Tentar de novo é seguro.";
  }
}
