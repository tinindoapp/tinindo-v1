// Textos do módulo Metas e conteúdo. Progresso com denominador; acompanhamento é variação observada, nunca efeito.
import type { Goal, GoalMetricKey } from "@contracts";

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
export const formatCents = (c: number) => BRL.format(c / 100);
export const formatDate = (v: string, timeZone = "America/Sao_Paulo") =>
  new Intl.DateTimeFormat("pt-BR", { timeZone, day: "2-digit", month: "2-digit" }).format(new Date(v));
export const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);
export const formatTarget = (unit: Goal["unit"], target: number) => (unit === "cents" ? formatCents(target) : pct(target));
export const METRIC_LABEL: Record<GoalMetricKey, string> = {
  occupancy: "Ocupação", no_show: "Faltas", cancellation: "Cancelamentos", waitlist_acceptance: "Ofertas de vaga aceitas", quote_acceptance: "Orçamentos aceitos",
  received: "Recebimentos registrados", expenses: "Despesas registradas", charge_coverage: "Atendimentos com cobrança registrada", reminders: "Lembretes enviados",
};
export const DIRECTION: Record<Goal["direction"], string> = { up: "quanto maior, melhor", down: "quanto menor, melhor" };
export const PROGRESS_STATUS: Record<Goal["progress"]["status"], string> = {
  ok: "medido", insufficient: "ainda sem dado suficiente (não é zero)", unavailable: "fonte ainda não existe",
};
export const OUTCOME: Record<string, string> = {
  improved: "melhorou 30 dias depois (variação observada, não efeito)",
  worsened: "piorou 30 dias depois (variação observada, não efeito)",
  unchanged: "igual 30 dias depois (variação observada, não efeito)",
  insufficient: "sem dado suficiente para comparar 30 dias depois",
};
export const DECISION: Record<"accepted" | "dismissed", string> = { accepted: "Aceita", dismissed: "Dispensada" };
export function explain(err: unknown): string {
  const e = err as { code?: string; field?: string } | null;
  switch (e?.code) {
    case "STALE_VERSION":
      return "Isto mudou em outro lugar. Atualizamos a tela: confira e tente de novo.";
    case "POLICY_REJECTED":
      if (e.field === "goal") return "Já existe uma meta ativa para este indicador neste mês. Ajuste a existente ou arquive-a.";
      if (e.field === "scope") return "Para publicar, o perfil público precisa estar publicado com o campo “apresentação” escolhido (tela Perfil).";
      if (e.field === "profession") return "Este texto é de outra profissão.";
      if (e.field === "kind") return "Só textos de apresentação vão para o perfil; posts são para você copiar.";
      if (e.field === "rule_code") return "Esta sugestão não está mais em vigor: os dados mudaram.";
      if (e.field === "decided") return "Você já decidiu sobre esta sugestão neste mês.";
      if (e.field === "status") return "Esta meta não está ativa.";
      return "As regras não permitem esta ação agora. Nada foi alterado.";
    case "VALIDATION_ERROR":
      return "Confira os campos: taxas entre 0% e 100%, valores em reais inteiros, mês válido.";
    case "NOT_FOUND":
      return "Não encontrado. A tela pode estar desatualizada.";
    case "FORBIDDEN":
      return "Só o dono do negócio acessa metas e conteúdo.";
    default:
      return "Não foi possível concluir agora. Tentar de novo é seguro.";
  }
}
