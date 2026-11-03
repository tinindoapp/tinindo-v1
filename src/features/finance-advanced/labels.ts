// Textos do módulo Contas. Dinheiro em centavos; datas civis no fuso do negócio; estado por palavra.
import type { AccPayable, AccStatement } from "@contracts";

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
export const formatCents = (c: number) => BRL.format(c / 100);
export const parseBRL = (v: string) => Math.round(Number(v.replace(/\./g, "").replace(",", ".")) * 100);
/** AAAA-MM-DD → 10/11/2026 (data civil: sem fuso). */
export const formatDay = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
export const localToday = (now: Date, timeZone: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
export const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
/** "1º a 30 de novembro de 2026", no fuso informado. */
export function periodLabel(p: AccStatement["period"]): string {
  const m = MONTHS[Number(p.first_day.slice(5, 7)) - 1];
  return `1º a ${Number(p.last_day.slice(8, 10))} de ${m} de ${p.first_day.slice(0, 4)}`;
}
export const monthLabel = (month: string) => `${MONTHS[Number(month.slice(5, 7)) - 1]} de ${month.slice(0, 4)}`;

export const BASE_LABEL: Record<string, string> = {
  supplies: "Materiais", rent: "Aluguel", utilities: "Contas da casa (água, luz, internet)", fees: "Taxas", transport: "Transporte",
  marketing: "Divulgação", other: "Outras despesas", services: "Atendimentos", packages: "Pacotes e assinaturas",
};
export const EXPENSE_BASES = ["supplies", "rent", "utilities", "fees", "transport", "marketing", "other"] as const;
export const METHOD_LABEL = { pix: "Pix", cash: "Dinheiro", card: "Cartão", transfer: "Transferência", other: "Outro" } as const;
export const SOURCE_LABEL = { manual: "registrado à mão", provider: "pelo pagamento conectado (PSP)" } as const;
export const STATUS_LABEL: Record<AccPayable["status"], string> = { open: "A pagar", overdue: "Vencida", paid: "Paga", cancelled: "Cancelada" };

export function explain(err: unknown): string {
  const e = err as { code?: string; field?: string } | null;
  switch (e?.code) {
    case "POLICY_REJECTED":
      if (e.field === "paid") return "Esta conta já está paga. Pagar de novo não lança outra despesa.";
      if (e.field === "not_paid") return "Esta conta não tem pagamento para estornar.";
      if (e.field === "status") return "A conta está paga ou cancelada; isso não vale mais para ela.";
      if (e.field === "name") return "Já existe uma categoria com esse nome.";
      return "As regras não permitem esta ação agora. Nada foi alterado.";
    case "STALE_VERSION":
      return "Isto mudou em outro lugar. Atualizamos a tela: confira e tente de novo.";
    case "VALIDATION_ERROR":
      if (e.field === "due_on") return "Conta mensal vence entre os dias 1 e 28.";
      if (e.field === "day") return "Escolha um dia que já passou ou hoje.";
      return "Confira os campos e tente de novo.";
    case "NOT_FOUND":
      return e.field === "category_id" ? "Use uma categoria do mesmo tipo (receita ou despesa)." : "Não encontrado. A tela pode estar desatualizada.";
    case "FORBIDDEN":
      return "Só o dono do negócio acessa as contas.";
    default:
      return "Não foi possível concluir agora. Tentar de novo é seguro.";
  }
}
