// Textos do módulo Contas. Dinheiro em centavos; datas civis no fuso do negócio; estado por palavra.
import type { AccPayable, AccStatement } from "@contracts";
import { errorExplainer } from "../../lib/errors.ts";

export { formatCents } from "../../lib/money.ts";
// Datas são do app inteiro (src/lib/time.ts). `localToday` é o nome que as portas deste módulo usam para `localDate`.
export { addDays, localDate as localToday } from "../../lib/time.ts";
const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
/** "1º a 30 de novembro de 2026", no fuso informado. */
export function periodLabel(p: AccStatement["period"]): string {
  const m = MONTHS[Number(p.first_day.slice(5, 7)) - 1];
  return `1º a ${Number(p.last_day.slice(8, 10))} de ${m} de ${p.first_day.slice(0, 4)}`;
}

export const BASE_LABEL: Record<string, string> = {
  supplies: "Materiais", rent: "Aluguel", utilities: "Contas da casa (água, luz, internet)", fees: "Taxas", transport: "Transporte",
  marketing: "Divulgação", other: "Outras despesas", services: "Atendimentos", packages: "Pacotes e assinaturas",
};
export const EXPENSE_BASES = ["supplies", "rent", "utilities", "fees", "transport", "marketing", "other"] as const;
export const METHOD_LABEL = { pix: "Pix", cash: "Dinheiro", card: "Cartão", transfer: "Transferência", other: "Outro" } as const;
export const SOURCE_LABEL = { manual: "registrado à mão", provider: "pelo pagamento conectado (PSP)" } as const;
export const STATUS_LABEL: Record<AccPayable["status"], string> = { open: "A pagar", overdue: "Vencida", paid: "Paga", cancelled: "Cancelada" };

export const explain = errorExplainer({
  "POLICY_REJECTED.paid": "Esta conta já está paga. Pagar de novo não lança outra despesa.",
  "POLICY_REJECTED.not_paid": "Esta conta não tem pagamento para estornar.",
  "POLICY_REJECTED.status": "A conta está paga ou cancelada; isso não vale mais para ela.",
  "POLICY_REJECTED.name": "Já existe uma categoria com esse nome.",
  POLICY_REJECTED: "As regras não permitem esta ação agora. Nada foi alterado.",
  STALE_VERSION: "Isto mudou em outro lugar. Atualizamos a tela: confira e tente de novo.",
  "VALIDATION_ERROR.due_on": "Conta mensal vence entre os dias 1 e 28.",
  "VALIDATION_ERROR.day": "Escolha um dia que já passou ou hoje.",
  VALIDATION_ERROR: "Confira os campos e tente de novo.",
  "NOT_FOUND.category_id": "Use uma categoria do mesmo tipo (receita ou despesa).",
  NOT_FOUND: "Não encontrado. A tela pode estar desatualizada.",
  FORBIDDEN: "Só o dono do negócio acessa as contas.",
});
