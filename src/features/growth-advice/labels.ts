// Textos do módulo Metas e conteúdo. Progresso com denominador; acompanhamento é variação observada, nunca efeito.
import type { Goal, GoalMetricKey, Insight, InsightRuleCode } from "@contracts";

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

// Evidência das sugestões em frases simples. Nunca mostra o nome cru do campo (ex.: no_show_n): chave sem rótulo vira
// "Outro dado". Cada frase é uma lista de pedaços; os números vão marcados para a tela usar a classe tn-num.
export type EvidenceChunk = { text: string; num?: boolean };
export type EvidencePhrase = EvidenceChunk[];
const INT = new Intl.NumberFormat("pt-BR");
const DEC = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const n = (v: number): EvidenceChunk => ({ text: INT.format(v), num: true });
const p = (v: number): EvidenceChunk => ({ text: pct(v), num: true });
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const yesNo = (v: unknown) => (v === true ? "sim" : v === false ? "não" : String(v));
/** Taxas que vêm acompanhadas do total (denominador) na mesma evidência. */
const RATE_WITH_TOTAL: Record<string, { label: string; total: string; phrase: (rate: number, total: number) => EvidencePhrase }> = {
  no_show: { label: "Faltas", total: "no_show_n", phrase: (r, t) => [{ text: "Faltas: " }, p(r), { text: " (" }, n(Math.round(r * t)), { text: " de " }, n(t), { text: " atendimentos)" }] },
  occupancy: { label: "Agenda ocupada", total: "sellable_minutes", phrase: (r, t) => [{ text: "Agenda ocupada: " }, p(r), { text: " de " }, { text: `${DEC.format(t / 60)} h`, num: true }] },
  charge_coverage: { label: "Atendimentos com cobrança", total: "completed", phrase: (r, t) => [{ text: "Atendimentos com cobrança: " }, p(r), { text: " de " }, n(t)] },
  quote_acceptance: { label: "Orçamentos aceitos", total: "quotes", phrase: (r, t) => [{ text: "Orçamentos aceitos: " }, p(r), { text: " de " }, n(t)] },
};
/** Campos avulsos (quando o par acima não veio completo, ou dados extras). */
const SINGLE: Record<string, (v: unknown) => EvidencePhrase> = {
  no_show: (v) => [{ text: "Faltas: " }, isNum(v) ? p(v) : { text: String(v) }],
  occupancy: (v) => [{ text: "Agenda ocupada: " }, isNum(v) ? p(v) : { text: String(v) }],
  charge_coverage: (v) => [{ text: "Atendimentos com cobrança: " }, isNum(v) ? p(v) : { text: String(v) }],
  quote_acceptance: (v) => [{ text: "Orçamentos aceitos: " }, isNum(v) ? p(v) : { text: String(v) }],
  reminders: (v) => [{ text: "Lembrete enviado: " }, isNum(v) ? p(v) : { text: String(v) }],
  no_show_n: (v) => [{ text: "Atendimentos com desfecho: " }, isNum(v) ? n(v) : { text: String(v) }],
  completed: (v) => [{ text: "Atendimentos concluídos: " }, isNum(v) ? n(v) : { text: String(v) }],
  quotes: (v) => [{ text: "Orçamentos enviados: " }, isNum(v) ? n(v) : { text: String(v) }],
  sellable_minutes: (v) => [{ text: "Horas livres para atender: " }, isNum(v) ? { text: `${DEC.format(v / 60)} h`, num: true } : { text: String(v) }],
  audience: (v) => (isNum(v) ? [n(v), { text: v === 1 ? " cliente que aceita mensagem" : " clientes que aceitam mensagem" }] : [{ text: `Clientes que aceitam mensagem: ${String(v)}` }]),
  profile_published: (v) => [{ text: `Perfil público publicado: ${yesNo(v)}` }],
  bio_field: (v) => [{ text: `Apresentação entre os campos públicos: ${yesNo(v)}` }],
};
export function formatEvidence(evidence: Record<string, unknown>): EvidencePhrase[] {
  const used = new Set<string>();
  const out: EvidencePhrase[] = [];
  for (const [k, v] of Object.entries(evidence)) {
    if (used.has(k)) continue;
    used.add(k);
    const pair = RATE_WITH_TOTAL[k];
    const total = pair ? evidence[pair.total] : undefined;
    if (pair && isNum(v) && isNum(total) && total > 0) {
      used.add(pair.total);
      out.push(pair.phrase(v, total));
    } else if (SINGLE[k]) {
      out.push(SINGLE[k](v));
    } else {
      // Indicador conhecido do Resultado ou chave nova: rótulo legível, nunca o nome do campo.
      const label = (METRIC_LABEL as Record<string, string>)[k] ?? "Outro dado";
      const value: EvidenceChunk = isNum(v) ? (k === "received" || k === "expenses" ? { text: formatCents(v), num: true } : k in METRIC_LABEL && v <= 1 ? p(v) : { text: DEC.format(v), num: true }) : { text: yesNo(v) };
      out.push([{ text: `${label}: ` }, value]);
    }
  }
  return out;
}
export const evidenceText = (evidence: Record<string, unknown>) => formatEvidence(evidence).map((ph) => ph.map((c) => c.text).join("")).join(" · ");

/** Nome de cada regra para a lista de decisões (nunca o código da regra). */
export const RULE_LABEL: Record<string, string> = {
  no_show_reminders: "Lembretes para reduzir faltas", occupancy_campaign: "Campanha para encher a agenda", charge_coverage: "Registrar cobrança dos atendimentos",
  quote_recurrence: "Oferecer assinatura", profile_bio: "Apresentação no perfil público",
  // P45 (decisões dos insights também ficam no acompanhamento do P22).
  uncharged_bookings: "Atendimentos sem cobrança", waitlist_opening: "Vaga com gente esperando", no_show_concentration: "Faltas concentradas",
  package_expiring: "Pacote perto de vencer", lapsed_customers: "Clientes sem retorno", idle_slot: "Horário ocioso",
  low_margin_service: "Serviço abaixo da margem", profile_incomplete: "Perfil incompleto", month_closing: "Mês fechando",
};
/** Texto do link de cada sugestão: diz o que a pessoa vai fazer lá. */
const ACTION_BY_RULE: Record<string, string> = {
  no_show_reminders: "Abrir lembretes", occupancy_campaign: "Montar campanha", charge_coverage: "Registrar cobranças", quote_recurrence: "Criar assinatura", profile_bio: "Ver textos aprovados",
};
const ACTION_BY_ROUTE: Record<string, string> = {
  "/app/relacionamento": "Abrir lembretes", "/app/campanhas": "Montar campanha", "/app/caixa": "Abrir o caixa", "/app/assinaturas": "Abrir assinaturas", "/app/metas": "Ver textos aprovados", "/app/perfil": "Abrir o perfil",
};
export const actionLabel = (rule: string, route: string) => ACTION_BY_RULE[rule] ?? ACTION_BY_ROUTE[route] ?? "Abrir a tela da sugestão";

// ---------------------------------------------------------------------------
// P45 · insights proativos. Toda frase de evidência diz o PERÍODO, o NÚMERO e o DENOMINADOR. Sem nome de cliente.
// ---------------------------------------------------------------------------

const WEEKDAY = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
/** "2026-10-04" → "04/10" (sem fuso: é data local do negócio). */
export const ddmm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const period = (e: Insight["evidence"]) => (e.period_start === e.period_end ? `hoje, ${ddmm(e.period_start)}` : `de ${ddmm(e.period_start)} a ${ddmm(e.period_end)}`);
const num = (v: unknown) => (typeof v === "number" ? INT.format(v) : String(v));

/** Uma frase com período, número e denominador, por regra (e uma genérica que nunca esconde o denominador). */
export function insightEvidence(i: Pick<Insight, "rule_code" | "evidence">): string {
  const e = i.evidence;
  const n = num(e.numerator), d = num(e.denominator);
  switch (i.rule_code) {
    case "uncharged_bookings": return `${n} de ${d} atendimentos concluídos com cobrança registrada, ${period(e)}.`;
    case "waitlist_opening": return `${n} ${e.numerator === 1 ? "vaga aberta" : "vagas abertas"} para ${d} ${e.denominator === 1 ? "pessoa esperando" : "pessoas esperando"}, ${period(e)}.`;
    case "no_show_concentration":
      return typeof e.weekday === "number"
        ? `${n} de ${d} atendimentos de ${WEEKDAY[e.weekday]} com falta, ${period(e)}.`
        : `${n} de ${d} faltas em clientes que faltam metade das vezes, ${period(e)}.`;
    case "package_expiring": return `${n} de ${d} pacotes ativos vencem ${period(e)}.`;
    case "lapsed_customers": return `${n} de ${d} clientes de retorno passaram do prazo, ${period(e)}.`;
    case "idle_slot": return `Vazia em ${n} de ${d} semanas, ${period(e)}.`;
    case "low_margin_service": return `${n} de ${d} ${e.denominator === 1 ? "serviço com ficha" : "serviços com ficha"} acima de 30% em materiais, custo médio de ${period(e)}.`;
    case "profile_incomplete": return `${n} de ${d} itens do perfil prontos (${period(e)}).`;
    case "month_closing": return `${n} de ${d} concluídos do mês com cobrança registrada, ${period(e)}.`;
    default: return `${n} de ${d}, ${period(e)}.`;
  }
}

/** Estado de cada regra na última rodada. Insuficiente ≠ zero: diz o que falta. */
export const RULE_STATUS: Record<"fire" | "quiet" | "insufficient", string> = {
  fire: "tem sugestão", quiet: "nada a sugerir", insufficient: "ainda sem dado suficiente (não é zero)",
};
export const RULE_REASON: Record<string, string> = {
  few_completed: "menos de 5 atendimentos concluídos nos últimos 30 dias",
  no_waitlist: "a lista de espera ainda não foi usada",
  few_outcomes: "menos de 20 atendimentos com desfecho nos últimos 60 dias",
  no_packages: "nenhum pacote vendido",
  few_returning_customers: "menos de 5 clientes que voltaram 2 vezes ou mais",
  no_hours: "expediente não cadastrado",
  history_short: "menos de 5 semanas de agenda",
  few_bookings: "menos de 10 atendimentos nas últimas 5 semanas",
  no_active_service: "nenhum serviço ativo",
  no_cost_sheet: "nenhum serviço com ficha de materiais e custo conhecido",
  setup_first: "configure o primeiro serviço antes",
  no_records: "nenhum registro de caixa no mês",
  not_closing: "o mês ainda não está no fim",
  covered: "cobrança registrada em 90% ou mais",
  no_open_slot: "nenhuma vaga aberta agora",
  spread: "faltas espalhadas, sem concentração",
  no_no_shows: "nenhuma falta no período",
  none_expiring: "nenhum pacote vence em 15 dias",
  all_returning: "clientes de retorno dentro do costume",
  no_idle_band: "nenhuma faixa vazia toda semana",
  margins_ok: "materiais abaixo de 30% do preço",
  complete: "perfil completo",
};
export const INSIGHT_STATE: Record<Insight["state"], string> = {
  open: "aberta", snoozed: "silenciada por 30 dias", acted: "preparada", resolved: "deixou de valer",
};
/** Retorno curto de "Preparar"/"Ver". */
export function actResultText(r: NonNullable<Insight["result"]>): string {
  if (r.kind === "pricing_proposal") return "Proposta de regra de preço criada. Ela só vale depois que você aprovar e publicar em Preços.";
  if (r.kind === "lifecycle_drafts") {
    const made = r.created === 1 ? "1 rascunho criado" : `${r.created} rascunhos criados`;
    const skipped = r.skipped ? ` ${r.skipped === 1 ? "1 cliente ficou" : `${r.skipped} clientes ficaram`} de fora por não ter autorizado mensagens.` : "";
    return `${made} em Relacionamento: nada foi enviado; revise e compartilhe de lá.${skipped}`;
  }
  return "Registrado. Em 30 dias medimos o mesmo número de novo (variação observada, não efeito).";
}
export const INSIGHT_RULE_LABEL: Record<InsightRuleCode, string> = {
  uncharged_bookings: "Atendimentos sem cobrança", waitlist_opening: "Vaga com gente esperando", no_show_concentration: "Faltas concentradas",
  package_expiring: "Pacote perto de vencer", lapsed_customers: "Clientes sem retorno", idle_slot: "Horário ocioso",
  low_margin_service: "Serviço abaixo da margem", profile_incomplete: "Perfil incompleto", month_closing: "Mês fechando",
};
export function explainInsight(err: unknown): string {
  const e = err as { code?: string; field?: string } | null;
  if (e?.code === "POLICY_REJECTED" && e.field === "stale") return "Os números mudaram desde a última conta: esta sugestão não vale mais. Nada foi criado.";
  if (e?.code === "POLICY_REJECTED" && e.field === "state") return "Esta sugestão já foi resolvida.";
  return explain(err);
}
