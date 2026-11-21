import { describe, expect, it } from "vitest";
import { InsightRuleCode } from "../../contracts/index.ts";
import { acceptableTone, explainFacts, fixedExplanation, insufficientExplanation } from "./explain-fixed.ts";

const ev = (numerator: number, denominator: number, extra: Record<string, unknown> = {}, period = ["2026-08-21", "2026-10-20"]) =>
  ({ period_start: period[0]!, period_end: period[1]!, numerator, denominator, ...extra });
const TODAY = ["2026-10-20", "2026-10-20"];

/** Uma evidência por regra, no formato que `app.gi_*` grava (migration p45). */
const CASES: Record<InsightRuleCode, [ReturnType<typeof ev>, string]> = {
  uncharged_bookings: [ev(3, 8, { uncharged: 5 }, ["2026-09-20", "2026-10-20"]),
    "De 20/09 a 20/10, 3 de 8 atendimentos concluídos tiveram a cobrança registrada. Sem ela, o Recebido e o fechamento do mês ficam incompletos. Registre os que faltam no Caixa."],
  waitlist_opening: [ev(1, 4, { recent_cancellations: 1 }, ["2026-10-13", "2026-10-20"]),
    "De 13/10 a 20/10, abriu 1 vaga e há 4 pessoas na lista de espera. Quem espera só fica sabendo se você oferecer. Ofereça a vaga na Lista de espera."],
  no_show_concentration: [ev(5, 12, { weekday: 3 }),
    "De 21/08 a 20/10, 5 de 12 atendimentos de quarta tiveram falta. Um lembrete no dia anterior costuma ajudar quem esquece. Ajuste os lembretes em Relacionamento."],
  package_expiring: [ev(2, 6, { sessions_left: 5 }, ["2026-10-20", "2026-11-04"]),
    "2 de 6 pacotes ativos vencem até 04/11 com sessões sobrando (5 no total). São sessões que a cliente já pagou. Prepare os avisos: ficam como rascunho para você revisar."],
  lapsed_customers: [ev(3, 9, { default_days: 60 }, ["2025-10-20", "2026-10-20"]),
    "Nos últimos 12 meses, 3 de 9 clientes que voltaram 2 vezes ou mais passaram do intervalo de costume. Um convite de retorno lembra quem sumiu, sem garantia de volta. Prepare os convites: ficam como rascunho para você revisar."],
  idle_slot: [ev(5, 5, { weekday: 6, band_start: 9, band_end: 14, bookings_in_period: 40 }, ["2026-09-14", "2026-10-18"]),
    "A faixa de sábado das 9h às 14h ficou vazia em 5 das 5 semanas, de 14/09 a 18/10. Uma regra de preço só para ela pode atrair quem tem horário flexível. Prepare a proposta e decida em Preços."],
  low_margin_service: [ev(1, 2, { service_name: "Corte", cost_cents: 2500, price_cents: 6000, threshold: 0.3 }, TODAY),
    "1 de 2 serviços com ficha passam de 30% do preço em materiais. O Corte gasta R$ 25,00 de materiais para um preço de R$ 60,00. Revise o preço ou a ficha em Preços."],
  profile_incomplete: [ev(3, 4, { missing: ["photo"] }, TODAY),
    "3 de 4 itens do perfil estão prontos. Quem chega pelo link decide mais rápido com o perfil completo. Complete o que falta pela tela indicada."],
  month_closing: [ev(30, 34, { received_cents: 180000, expenses_cents: 40000, open_receivables_cents: 12000 }, ["2026-10-01", "2026-10-31"]),
    "De 01/10 a 31/10, 30 de 34 atendimentos concluídos tiveram a cobrança registrada. É o caixa registrado até agora, não um balanço. Confira o mês em Contas."],
};

describe("\"Por quê?\" · frase fixa por regra (sem modelo)", () => {
  it("uma frase para cada uma das 9 regras do catálogo", () => {
    expect(Object.keys(CASES).sort()).toEqual([...InsightRuleCode.options].sort());
  });

  it.each(Object.entries(CASES))("%s: período, número e denominador da evidência; tom da §2.5", (rule, [e, text]) => {
    const out = fixedExplanation(rule as InsightRuleCode, e);
    expect(out).toBe(text);
    expect(acceptableTone(out)).toBe(true);
    expect(out).not.toMatch(/\bvocê vai\b|garant(e|imos)|\bIA\b/);
    // Todo número da frase vem da evidência (os mesmos que o modelo pode usar) ou é limite fixo da regra.
    const RULE_CONSTANTS = { lapsed_customers: ["12", "2"], low_margin_service: ["30"] } as Record<string, string[]>;
    const allowed = new Set([...JSON.stringify(explainFacts(rule as InsightRuleCode, e)).match(/\d+(?:[.,]\d+)?/g) ?? [], ...(RULE_CONSTANTS[rule] ?? [])]);
    for (const n of out.match(/\d+(?:[.,]\d+)?/g) ?? []) expect(allowed, `${rule}: ${n}`).toContain(n);
  });

  it("faltas concentradas em clientes (sem dia da semana) e horário ocioso sem faixa não inventam nada", () => {
    expect(fixedExplanation("no_show_concentration", ev(4, 6))).toBe(
      "De 21/08 a 20/10, 4 das 6 faltas foram de clientes que faltam em metade das vezes ou mais. Confirmação e lembrete para quem falta costumam ajudar. Ajuste os lembretes em Relacionamento.");
    expect(fixedExplanation("idle_slot", ev(4, 5))).toMatch(/^Uma faixa do expediente ficou vazia em 4 das 5 semanas/);
    expect(fixedExplanation("waitlist_opening", ev(2, 1, {}, TODAY))).toBe(
      "Hoje, 20/10, abriram 2 vagas e há 1 pessoa na lista de espera. Quem espera só fica sabendo se você oferecer. Ofereça a vaga na Lista de espera.");
  });

  it("dado insuficiente: o que falta, o número de agora quando se sabe, e que isso não é zero (§3.24)", () => {
    expect(insufficientExplanation("few_returning_customers", 4)).toBe(
      "Ainda não dá para saber se seus clientes estão voltando: preciso de pelo menos 5 clientes com 2 atendimentos. Hoje são 4. Isso não quer dizer zero.");
    expect(insufficientExplanation("few_returning_customers", 1)).toContain("Hoje é 1.");
    expect(insufficientExplanation("few_returning_customers")).toBe(
      "Ainda não dá para saber se seus clientes estão voltando: preciso de pelo menos 5 clientes com 2 atendimentos. Isso não quer dizer zero.");
    // Cada motivo de insuficiente que o motor grava (app.gi_*) tem frase.
    for (const reason of ["few_completed", "no_waitlist", "few_outcomes", "no_packages", "few_returning_customers", "no_hours", "history_short",
      "few_bookings", "no_active_service", "no_cost_sheet", "setup_first", "no_records"]) {
      const s = insufficientExplanation(reason);
      expect(s, reason).toMatch(/^Ainda não dá para saber .+: .+\. Isso não quer dizer zero\.$/);
      expect(acceptableTone(s!)).toBe(true);
    }
    expect(insufficientExplanation("motivo_novo")).toBeNull();
    expect(insufficientExplanation(null)).toBeNull();
  });

  it("fatos para o modelo: só números com rótulo e o período; nada de nome, lista ou id", () => {
    expect(explainFacts("low_margin_service", CASES.low_margin_service[0])).toEqual({
      periodo: "hoje, 20/10", numero: 1, de: 2, custo_materiais: "R$ 25,00", preco: "R$ 60,00", limite_de_referencia: "30%",
    });
    expect(explainFacts("profile_incomplete", CASES.profile_incomplete[0])).toEqual({ periodo: "hoje, 20/10", numero: 3, de: 4 });
    expect(explainFacts("idle_slot", CASES.idle_slot[0])).toEqual({ periodo: "de 14/09 a 18/10", numero: 5, de: 5, dia_da_semana: "sábado", faixa: "das 9h às 14h" });
  });

  it("tom: exclamação ou \"IA\" na frase do modelo não passa", () => {
    expect(acceptableTone("Ligue os lembretes!")).toBe(false);
    expect(acceptableTone("A IA viu faltas na quarta.")).toBe(false);
    expect(acceptableTone("De 21/08 a 20/10, 5 de 12 atendimentos de quarta tiveram falta.")).toBe(true);
  });
});
