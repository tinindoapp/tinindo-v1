// "Por quê?" nos insights (revisão de 04/11, T3 e §3.24): frase FIXA por regra, determinística e sem modelo. Vale para
// o servidor (rota `insight.explain` da Edge Function `growth-advice`, quando não há provedor, o modelo falha, a
// franquia acabou ou a frase do modelo trouxe número fora da evidência) e para a demonstração (sem rede).
//
// Regras do texto (§2.5): segunda pessoa, frase curta, sem promessa de resultado, sem exclamação, sem "IA", fecha com
// o que o dono pode fazer. Só os números que o motor do P45 gravou na evidência; nunca nome de cliente.
// Também monta os fatos que vão para o modelo (`explainFacts`): título da regra e números com rótulo, nada mais.
import type { InsightRuleCode } from "../../contracts/index.ts";
import { money } from "./time.ts";

/** Evidência do insight como o motor grava: período, número e denominador sempre; o resto são contagens e taxas. */
export interface ExplainEvidence {
  period_start: string;
  period_end: string;
  numerator: number;
  denominator: number;
  [key: string]: unknown;
}

const WEEKDAY = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
const INT = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
/** "2026-10-04" → "04/10" (data local do negócio, sem fuso). */
export const ddmm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? INT.format(v) : "?");
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const plural = (k: number, one: string, many: string) => (k === 1 ? one : many);
/** "de 21/08 a 20/10" ou "hoje, 20/10". */
export const periodText = (e: Pick<ExplainEvidence, "period_start" | "period_end">) =>
  e.period_start === e.period_end ? `hoje, ${ddmm(e.period_start)}` : `de ${ddmm(e.period_start)} a ${ddmm(e.period_end)}`;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Frase fixa para um insight que disparou, pela regra e pela evidência. */
export function fixedExplanation(rule: InsightRuleCode, e: ExplainEvidence): string {
  const p = periodText(e);
  const num = e.numerator, den = e.denominator;
  switch (rule) {
    case "uncharged_bookings":
      return `${cap(p)}, ${n(num)} de ${n(den)} atendimentos concluídos tiveram a cobrança registrada. Sem ela, o Recebido e o fechamento do mês ficam incompletos. Registre os que faltam no Caixa.`;
    case "waitlist_opening":
      return `${cap(p)}, ${plural(num, "abriu 1 vaga", `abriram ${n(num)} vagas`)} e há ${plural(den, "1 pessoa", `${n(den)} pessoas`)} na lista de espera. Quem espera só fica sabendo se você oferecer. Ofereça a vaga na Lista de espera.`;
    case "no_show_concentration":
      return isNum(e.weekday) && e.weekday >= 0 && e.weekday <= 6
        ? `${cap(p)}, ${n(num)} de ${n(den)} atendimentos de ${WEEKDAY[e.weekday]} tiveram falta. Um lembrete no dia anterior costuma ajudar quem esquece. Ajuste os lembretes em Relacionamento.`
        : `${cap(p)}, ${n(num)} das ${n(den)} faltas foram de clientes que faltam em metade das vezes ou mais. Confirmação e lembrete para quem falta costumam ajudar. Ajuste os lembretes em Relacionamento.`;
    case "package_expiring":
      return `${n(num)} de ${n(den)} pacotes ativos vencem até ${ddmm(e.period_end)} com sessões sobrando${isNum(e.sessions_left) ? ` (${n(e.sessions_left)} no total)` : ""}. São sessões que a cliente já pagou. Prepare os avisos: ficam como rascunho para você revisar.`;
    case "lapsed_customers":
      // O período da regra é de 12 meses: "de 20/10 a 20/10" confundiria (a data local não tem ano).
      return `Nos últimos 12 meses, ${n(num)} de ${n(den)} clientes que voltaram 2 vezes ou mais passaram do intervalo de costume. Um convite de retorno lembra quem sumiu, sem garantia de volta. Prepare os convites: ficam como rascunho para você revisar.`;
    case "idle_slot": {
      const band = isNum(e.weekday) && isNum(e.band_start) && isNum(e.band_end)
        ? `A faixa de ${WEEKDAY[e.weekday] ?? "?"} das ${n(e.band_start)}h às ${n(e.band_end)}h`
        : "Uma faixa do expediente";
      return `${band} ficou vazia em ${n(num)} das ${n(den)} semanas, ${p}. Uma regra de preço só para ela pode atrair quem tem horário flexível. Prepare a proposta e decida em Preços.`;
    }
    case "low_margin_service": {
      const svc = typeof e.service_name === "string" && e.service_name ? e.service_name : null;
      const detail = svc && isNum(e.cost_cents) && isNum(e.price_cents) ? ` O ${svc} gasta ${money(e.cost_cents)} de materiais para um preço de ${money(e.price_cents)}.` : "";
      return `${n(num)} de ${n(den)} ${plural(den, "serviço com ficha passa", "serviços com ficha passam")} de 30% do preço em materiais.${detail} Revise o preço ou a ficha em Preços.`;
    }
    case "profile_incomplete":
      return `${n(num)} de ${n(den)} itens do perfil estão prontos. Quem chega pelo link decide mais rápido com o perfil completo. Complete o que falta pela tela indicada.`;
    case "month_closing":
      return `${cap(p)}, ${n(num)} de ${n(den)} atendimentos concluídos tiveram a cobrança registrada. É o caixa registrado até agora, não um balanço. Confira o mês em Contas.`;
  }
}

/**
 * O que falta para a regra poder dizer algo, pelo motivo que o motor do P45 grava (`app.gi_*`, status
 * `insufficient`). `current` é o número de agora quando ele é conhecido (a demonstração sabe; o motor não grava).
 */
const INSUFFICIENT: Record<string, { what: string; need: string }> = {
  few_completed: { what: "se você registra a cobrança dos atendimentos", need: "preciso de pelo menos 5 atendimentos concluídos nos últimos 30 dias" },
  no_waitlist: { what: "se há vaga para quem espera", need: "a lista de espera ainda não foi usada" },
  few_outcomes: { what: "se as faltas se concentram em algum dia", need: "preciso de pelo menos 20 atendimentos com desfecho nos últimos 60 dias" },
  no_packages: { what: "se há pacote perto de vencer", need: "nenhum pacote foi vendido ainda" },
  few_returning_customers: { what: "se seus clientes estão voltando", need: "preciso de pelo menos 5 clientes com 2 atendimentos" },
  no_hours: { what: "se há horário vazio toda semana", need: "o expediente ainda não foi cadastrado" },
  history_short: { what: "se há horário vazio toda semana", need: "preciso de pelo menos 5 semanas de agenda" },
  few_bookings: { what: "se há horário vazio toda semana", need: "preciso de pelo menos 10 atendimentos nas últimas 5 semanas" },
  no_active_service: { what: "se vale uma regra de preço para o horário vazio", need: "preciso de pelo menos um serviço ativo" },
  no_cost_sheet: { what: "se os materiais pesam no preço", need: "preciso de pelo menos um serviço com ficha de materiais e custo conhecido" },
  setup_first: { what: "se o perfil está pronto", need: "configure o primeiro serviço antes" },
  no_records: { what: "como o mês está fechando", need: "ainda não há registro de caixa neste mês" },
};

/** Frase para regra sem dado suficiente. Insuficiente não é zero, e a frase diz isso. null se o motivo é desconhecido. */
export function insufficientExplanation(reason: string | null, current?: number | null): string | null {
  const r = reason ? INSUFFICIENT[reason] : undefined;
  if (!r) return null;
  const now = isNum(current) ? ` Hoje ${current === 1 ? "é" : "são"} ${n(current)}.` : "";
  return `Ainda não dá para saber ${r.what}: ${r.need}.${now} Isso não quer dizer zero.`;
}

/**
 * Fatos que vão para o modelo (tarefa EXPLAIN): só números com rótulo e o período. Fica de fora tudo o que não é
 * número da conta (ids, listas, rotas). Nome de serviço é do catálogo do próprio negócio (§2.4), nunca de cliente.
 */
export function explainFacts(rule: InsightRuleCode, e: ExplainEvidence): Record<string, string | number> {
  const f: Record<string, string | number> = { periodo: periodText(e), numero: e.numerator, de: e.denominator };
  if (rule === "no_show_concentration" && isNum(e.weekday)) f.dia_da_semana = WEEKDAY[e.weekday] ?? "";
  if (rule === "idle_slot" && isNum(e.weekday) && isNum(e.band_start) && isNum(e.band_end)) {
    f.dia_da_semana = WEEKDAY[e.weekday] ?? "";
    f.faixa = `das ${e.band_start}h às ${e.band_end}h`;
  }
  if (rule === "package_expiring" && isNum(e.sessions_left)) f.sessoes_sobrando = e.sessions_left;
  if (rule === "low_margin_service" && isNum(e.cost_cents) && isNum(e.price_cents)) {
    f.custo_materiais = money(e.cost_cents);
    f.preco = money(e.price_cents);
    f.limite_de_referencia = "30%";
  }
  if (rule === "month_closing") {
    if (isNum(e.received_cents)) f.recebido = money(e.received_cents);
    if (isNum(e.expenses_cents)) f.despesas = money(e.expenses_cents);
    if (isNum(e.open_receivables_cents)) f.a_receber = money(e.open_receivables_cents);
  }
  return f;
}

/** Tom (§2.5): frase do modelo com exclamação ou que fala de "IA" vira a frase fixa. */
export function acceptableTone(sentence: string): boolean {
  return !/!/.test(sentence) && !/\b(IA|inteligência artificial)\b/i.test(sentence);
}
