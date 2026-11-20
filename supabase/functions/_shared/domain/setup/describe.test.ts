import { describe, expect, it } from "vitest";
import { SetupDescribeDraft } from "../../contracts/setup.ts";
import type { BusinessDraft } from "../../llm/tasks/setup.ts";
import { BusinessDescription, describeBusiness, draftToWeeklyWindows, mergeAssistantDraft } from "./describe.ts";
import { SERVICE_TEMPLATES } from "./templates.ts";

describe("descreva seu negócio em uma frase (analisador por regras)", () => {
  it("frase do docs/12: barbeiro, sozinho, terça a sábado das 9 às 19", () => {
    const d = describeBusiness("Sou barbeiro, sozinho, de terça a sábado das 9 às 19");
    expect(SetupDescribeDraft.parse(d)).toEqual({
      profession: "barber", team_size: 1, weekdays: [2, 3, 4, 5, 6], start: "09:00", end: "19:00", pause: null, services: [], unknown: [],
    });
  });

  it("cabeleireira com equipe, dias úteis, horário com minutos e almoço, serviços citados", () => {
    const d = describeBusiness("Cabeleireira, somos 3 no salão, dias úteis das 8:30 às 18h com almoço das 12 às 13. Faço corte, escova e coloração.");
    expect(d.profession).toBe("hairdresser");
    expect(d.team_size).toBe(3);
    expect(d.weekdays).toEqual([1, 2, 3, 4, 5]);
    expect([d.start, d.end]).toEqual(["08:30", "18:00"]);
    expect(d.pause).toEqual({ start: "12:00", end: "13:00" });
    expect(d.services).toEqual(["Corte", "Escova", "Coloração"]);
    expect(draftToWeeklyWindows(d)).toEqual([1, 2, 3, 4, 5].flatMap((weekday) => [
      { weekday, local_start: "08:30", local_end: "12:00" }, { weekday, local_start: "13:00", local_end: "18:00" },
    ]));
  });

  it("personal: 'eu e mais um', dias soltos, horário da manhã e da noite", () => {
    const d = describeBusiness("personal trainer, eu e mais um, segunda, quarta e sexta das 6 da manhã às 9 da noite, treino e avaliação");
    expect(d.profession).toBe("personal_trainer");
    expect(d.team_size).toBe(2);
    expect(d.weekdays).toEqual([1, 3, 5]);
    expect([d.start, d.end]).toEqual(["06:00", "21:00"]);
    expect(d.services).toEqual(["Avaliação física", "Sessão individual"]);
    expect(d.unknown).toEqual([]);
  });

  it("fim menor que o início sem 'da noite' é da tarde; abreviações e hífen; todo dia", () => {
    expect(describeBusiness("barbearia seg-sab 9h-7h").weekdays).toEqual([1, 2, 3, 4, 5, 6]);
    expect(describeBusiness("barbearia seg-sab 9h-7h")).toMatchObject({ start: "09:00", end: "19:00" });
    expect(describeBusiness("atendo todo dia das 10 às 22").weekdays).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(describeBusiness("sábado e domingo das 8 às 12").weekdays).toEqual([0, 6]);
    expect(describeBusiness("fim de semana das 8 às 12").weekdays).toEqual([0, 6]);
  });

  it("o que não entendeu volta em unknown, nunca inventa", () => {
    const d = describeBusiness("faço unhas em casa");
    expect(d).toMatchObject({ profession: null, team_size: null, weekdays: [], start: null, end: null, pause: null, services: [] });
    expect(d.unknown).toEqual(["profession", "weekdays", "hours"]);
    expect(describeBusiness("")).toMatchObject({ unknown: ["profession", "weekdays", "hours"] });
    // Horário invertido sem pista de período: não vira expediente.
    expect(describeBusiness("barbeiro das 19 às 19")).toMatchObject({ start: null, end: null });
    expect(draftToWeeklyWindows({ weekdays: [1], start: null, end: null, pause: null })).toEqual([]);
  });

  it("pausa fora do expediente é ignorada ao montar as janelas; profissão é a primeira citada", () => {
    const d = describeBusiness("Sou barbeiro e cabeleireiro, de segunda a sexta das 9 às 12 com pausa das 12 às 13");
    expect(d.profession).toBe("barber");
    expect(draftToWeeklyWindows(d)).toEqual([1, 2, 3, 4, 5].map((weekday) => ({ weekday, local_start: "09:00", local_end: "12:00" })));
  });
});

const win = (d: { windows: { weekday: number; local_start: string; local_end: string }[] }) => d.windows.map((w) => `${w.weekday} ${w.local_start}-${w.local_end}`);
const days = (list: number[], ...blocks: string[]) => list.flatMap((d) => blocks.map((b) => `${d} ${b}`));
const notes = (d: { notes: { field: string; level: string; text: string }[] }, field: string) => d.notes.filter((n) => n.field === field).map((n) => `${n.level}: ${n.text}`);

// P50 · frases reais da revisão de 04/11 (docs/qa/revisao-2026-11-04/01-jornada-profissional.md, achado A4 e personas).
describe("P50 · frases reais do barbeiro", () => {
  it("negação: 'não atendo domingo e segunda' marca os outros dias e avisa", () => {
    const d = describeBusiness("Não atendo domingo e segunda. Sou barbeiro, das 9 às 20");
    expect(BusinessDescription.parse(d)).toEqual(d);
    expect(d.weekdays).toEqual([2, 3, 4, 5, 6]);
    expect(win(d)).toEqual(days([2, 3, 4, 5, 6], "09:00-20:00"));
    expect(notes(d, "weekdays")).toEqual(["check: Você disse que não atende domingo e segunda: marquei terça a sábado. Confira."]);
    expect(d.unknown).toEqual([]);
  });

  it("outras formas de negar: menos, exceto, folga, fechado, 'não abro aos domingos'", () => {
    expect(describeBusiness("barbeiro, de segunda a sábado menos quinta, das 9 às 18").weekdays).toEqual([1, 2, 3, 5, 6]);
    expect(describeBusiness("barbearia todos os dias exceto domingo das 9 às 19").weekdays).toEqual([1, 2, 3, 4, 5, 6]);
    expect(describeBusiness("barbeiro, folga na segunda, das 10 às 20").weekdays).toEqual([0, 2, 3, 4, 5, 6]);
    expect(describeBusiness("barbeiro, terça a sábado das 9 às 19. Domingo e segunda fechado").weekdays).toEqual([2, 3, 4, 5, 6]);
    expect(describeBusiness("barbeiro, não abro aos domingos, atendo de segunda a sábado das 9 às 19").weekdays).toEqual([1, 2, 3, 4, 5, 6]);
    // A negação não alcança o intervalo depois da vírgula.
    expect(describeBusiness("Barbeiro, não atendo domingo e segunda, terça a sexta 10 às 20 e sábado 8 às 16").weekdays).toEqual([2, 3, 4, 5, 6]);
  });

  it("dias com horários diferentes: 'terça a sexta 10 às 20 e sábado 8 às 16'", () => {
    const d = describeBusiness("barbeiro, terça a sexta 10 às 20 e sábado 8 às 16");
    expect(win(d)).toEqual([...days([2, 3, 4, 5], "10:00-20:00"), "6 08:00-16:00"]);
    // O resumo do contrato v1 fica com o horário da maioria dos dias.
    expect([d.start, d.end, d.pause]).toEqual(["10:00", "20:00", null]);
    expect(notes(d, "hours")).toEqual(["check: Horários diferentes por dia: sábado, 08:00 às 16:00. Confira."]);
  });

  it("sábado só com o fim ('até as 14h') usa o início dos outros dias; dia repetido vale o último horário", () => {
    expect(win(describeBusiness("barbeiro, segunda a sexta das 9 às 18 e sábado até as 14h"))).toEqual([...days([1, 2, 3, 4, 5], "09:00-18:00"), "6 09:00-14:00"]);
    expect(win(describeBusiness("barbeiro, terça a sábado das 9 às 19, sábado das 9 às 14"))).toEqual([...days([2, 3, 4, 5], "09:00-19:00"), "6 09:00-14:00"]);
  });

  it("frase sem serviços sugere os modelos da profissão; com serviços, duração e faixa do modelo e preço só se dito", () => {
    const none = describeBusiness("Sou barbeiro, sozinho, de terça a sábado das 9 às 19");
    expect(none.services).toEqual([]);
    expect(none.service_drafts.map((s) => [s.name, s.template_code, s.duration_min, s.price_cents, s.cited])).toEqual([
      ["Corte", "barber_corte", 30, null, false], ["Barba", "barber_barba", 20, null, false], ["Corte e barba", "barber_corte_barba", 50, null, false],
    ]);
    expect(none.sources.services).toBeNull();
    const said = describeBusiness("barbeiro de terça a sábado das 9 às 19, corte 40 minutos por 50 reais, barba R$ 35,50 e sobrancelha");
    expect(said.service_drafts).toEqual([
      { name: "Corte", template_code: "barber_corte", duration_min: 40, price_cents: 5000, price_from_cents: 3500, price_to_cents: 7000, cited: true },
      { name: "Barba", template_code: "barber_barba", duration_min: 20, price_cents: 3550, price_from_cents: 2500, price_to_cents: 5000, cited: true },
      { name: "Sobrancelha", template_code: null, duration_min: null, price_cents: null, price_from_cents: null, price_to_cents: null, cited: true },
    ]);
    expect(said.sources.services).toBe("rules");
  });

  it("recusa diz o campo e o motivo: horário invertido, horário sem fim, dias sem horário", () => {
    const inverted = describeBusiness("barbeiro de terça a sábado das 19 às 19");
    expect(inverted.unknown).toEqual(["hours"]);
    expect(notes(inverted, "hours")).toEqual(["refused: Não usei o horário “das 19 às 19”: o fim precisa vir depois do início."]);
    const open = describeBusiness("barbearia, todos os dias, abro às 9h");
    expect(open.unknown).toEqual(["hours"]);
    expect(notes(open, "hours")).toEqual([
      "check: Não usei este trecho: “às 9h”. Um horário precisa de início e fim.",
      "refused: Não encontrei um horário com início e fim na frase. Informe abaixo.",
    ]);
    const empty = describeBusiness("");
    expect(empty.notes.map((n) => [n.field, n.level])).toEqual([["profession", "refused"], ["weekdays", "refused"], ["hours", "refused"]]);
    expect(empty.sources).toEqual({ profession: null, team_size: null, weekdays: null, hours: null, services: null });
  });

  it("'ter' sozinho é verbo, não terça; em lista ou intervalo é terça", () => {
    expect(describeBusiness("barbeiro, quero ter mais clientes, sábado das 9 às 14").weekdays).toEqual([6]);
    expect(describeBusiness("barbeiro seg, ter e qua das 9 às 18").weekdays).toEqual([1, 2, 3]);
    expect(describeBusiness("barbeiro ter a sab 9h-19h").weekdays).toEqual([2, 3, 4, 5, 6]);
  });
});

describe("P50 · frases reais da cabeleireira", () => {
  const sentence = "Cabeleireira autônoma, trabalho com coloração, mechas e progressiva. Vendo pacote de hidratação com 4 sessões. Atendo de terça a sábado, 9h–19h";

  it("travessão no horário; 'pacote com 4 sessões' é pacote, não equipe de 4 nem serviço de personal", () => {
    const d = describeBusiness(sentence);
    expect(d.profession).toBe("hairdresser");
    expect(d.team_size).toBe(1);
    expect(win(d)).toEqual(days([2, 3, 4, 5, 6], "09:00-19:00"));
    expect(d.packages).toEqual([{ sessions: 4, service: "Hidratação" }]);
    expect(d.services).toEqual(["Coloração", "Hidratação", "Progressiva", "Luzes"]);
    expect(d.services).not.toContain("Sessão individual");
    expect(d.unknown).toEqual([]);
    expect(d.notes).toEqual([]);
  });

  it("serviços com a duração e a faixa do modelo da profissão; sem modelo, o dono informa", () => {
    const d = describeBusiness(sentence);
    expect(d.service_drafts.map((s) => [s.name, s.template_code, s.duration_min, s.price_from_cents, s.price_to_cents, s.price_cents])).toEqual([
      ["Coloração", "hair_coloracao", 120, 12000, 35000, null],
      ["Hidratação", "hair_hidratacao", 45, 5000, 15000, null],
      ["Progressiva", null, null, null, null, null],
      ["Luzes", null, null, null, null, null],
    ]);
    // Toda faixa e duração vêm da lista de modelos (cópia da migration), nunca de conta feita aqui.
    const coloracao = SERVICE_TEMPLATES.find((t) => t.code === "hair_coloracao")!;
    expect([coloracao.duration_min, coloracao.price_from_cents, coloracao.price_to_cents]).toEqual([120, 12000, 35000]);
  });

  it("'somos 3' é equipe; 'com 4 sessões', 'temos 3 cadeiras' e '2 clientes' não são", () => {
    expect(describeBusiness("salão, somos 3, de segunda a sexta das 9 às 18").team_size).toBe(3);
    expect(describeBusiness("salão com 3 profissionais, de segunda a sexta das 9 às 18").team_size).toBe(3);
    expect(describeBusiness("cabeleireira, pacote com 4 sessões, de segunda a sexta das 9 às 18").team_size).toBeNull();
    expect(describeBusiness("salão, temos 3 cadeiras, de segunda a sexta das 9 às 18").team_size).toBeNull();
    expect(describeBusiness("cabeleireira, atendo de 2 a 3 clientes por dia, terça a sábado das 9 às 18")).toMatchObject({ team_size: null, start: "09:00", end: "18:00" });
  });

  it("almoço dito na frase divide os blocos; 'meio-dia' é lido; segundo turno menor que o fim do primeiro é da tarde", () => {
    const lunch = describeBusiness("Sou cabeleireira, de terça a sábado das 9 às 18 com almoço das 12 às 13. Faço corte e escova.");
    expect(win(lunch)).toEqual(days([2, 3, 4, 5, 6], "09:00-12:00", "13:00-18:00"));
    expect(lunch.pause).toEqual({ start: "12:00", end: "13:00" });
    // Com a pausa dita, não há aviso de "dois períodos" (a pessoa pediu a pausa).
    expect(notes(lunch, "hours")).toEqual([]);
    const noon = describeBusiness("cabeleireira, quarta a domingo das 10 ao meio-dia e das 14 às 20");
    expect(win(noon)).toEqual(days([0, 3, 4, 5, 6], "10:00-12:00", "14:00-20:00"));
    const afternoon = describeBusiness("salão, de segunda a sexta das 8 às 12 e das 2 às 6");
    expect(win(afternoon)).toEqual(days([1, 2, 3, 4, 5], "08:00-12:00", "14:00-18:00"));
    expect(notes(afternoon, "hours").some((n) => n.includes("Entendi que é à tarde"))).toBe(true);
  });
});

describe("P50 · frases reais do personal", () => {
  it("dois turnos e a domicílio: 'de segunda a sexta das 6 às 12 e das 17 às 21'", () => {
    const d = describeBusiness("Sou personal trainer, atendo a domicílio de segunda a sexta das 6 às 12 e das 17 às 21");
    expect(d.profession).toBe("personal_trainer");
    expect(d.at_home).toBe(true);
    expect(win(d)).toEqual(days([1, 2, 3, 4, 5], "06:00-12:00", "17:00-21:00"));
    // No resumo do contrato v1 os dois turnos viram início, fim e pausa: draftToWeeklyWindows dá os mesmos blocos.
    expect([d.start, d.end, d.pause]).toEqual(["06:00", "21:00", { start: "12:00", end: "17:00" }]);
    expect(draftToWeeklyWindows(d)).toEqual(d.windows);
    expect(notes(d, "hours")).toEqual(["check: Li dois períodos por dia: 06:00 às 12:00 e 17:00 às 21:00. Confira."]);
    expect(d.unknown).toEqual([]);
  });

  it("'pacote de 10 sessões' é pacote sobre a sessão avulsa, com a duração do modelo; não é equipe", () => {
    const d = describeBusiness("personal, pacote de 10 sessões, seg a sex das 6h às 11h, sábado até meio-dia");
    expect(d.packages).toEqual([{ sessions: 10, service: "Sessão individual" }]);
    expect(d.team_size).toBeNull();
    expect(d.service_drafts).toEqual([
      { name: "Sessão individual", template_code: "pt_sessao", duration_min: 60, price_cents: null, price_from_cents: 8000, price_to_cents: 20000, cited: true },
    ]);
    expect(win(d)).toEqual([...days([1, 2, 3, 4, 5], "06:00-11:00"), "6 06:00-12:00"]);
  });

  it("a domicílio dito de outros jeitos; 'em casa' não conta (pode ser a casa do profissional)", () => {
    expect(describeBusiness("personal, atendimento domiciliar, seg a sex das 7 às 11").at_home).toBe(true);
    expect(describeBusiness("personal, treino na casa do aluno, seg a sex das 7 às 11").at_home).toBe(true);
    expect(describeBusiness("faço unhas em casa").at_home).toBe(false);
    expect(describeBusiness("Sou barbeiro, sozinho, de terça a sábado das 9 às 19").at_home).toBe(false);
  });

  it("manhã e noite com o período dito; dias soltos com dois turnos", () => {
    const d = describeBusiness("personal trainer, segunda, quarta e sexta das 6 da manhã às 10 da manhã e das 6 da tarde às 9 da noite, treino e avaliação");
    expect(win(d)).toEqual(days([1, 3, 5], "06:00-10:00", "18:00-21:00"));
    expect(d.services).toEqual(["Avaliação física", "Sessão individual"]);
  });
});

describe("P50 · assistente completa só o que as regras não leram (mergeAssistantDraft)", () => {
  const llm = (over: Partial<BusinessDraft>): BusinessDraft => ({ profession: null, team_size: null, hours: [], services: [], ...over });

  it("sem resposta do modelo, o rascunho das regras não muda", () => {
    const d = describeBusiness("faço unhas em casa");
    expect(mergeAssistantDraft(d, null, "faço unhas em casa")).toBe(d);
  });

  it("profissão que faltava vem do assistente, com o selo; o que as regras leram fica como está", () => {
    const sentence = "faço a barba e o cabelo da rapaziada, de terça a sábado das 9 às 19";
    const rules = describeBusiness(sentence);
    expect(rules.unknown).toEqual(["profession"]);
    const d = mergeAssistantDraft(rules, llm({ profession: "barber", hours: [{ weekday: 1, start: "08:00", end: "12:00" }], services: [{ name: "Corte", duration_min: null, price_cents: null }] }), sentence);
    expect(BusinessDescription.parse(d)).toEqual(d);
    expect(d.profession).toBe("barber");
    expect(d.unknown).toEqual([]);
    expect(d.sources).toMatchObject({ profession: "assistant", weekdays: "rules", hours: "rules", services: "rules" });
    // Dias, horário e serviços das regras não são trocados pelos do modelo.
    expect(d.windows).toEqual(rules.windows);
    expect(d.services).toEqual(["Barba"]);
    // Com a profissão conhecida, o serviço ganha a duração e a faixa do modelo dela.
    expect(d.service_drafts).toEqual([{ name: "Barba", template_code: "barber_barba", duration_min: 20, price_cents: null, price_from_cents: 2500, price_to_cents: 5000, cited: true }]);
    expect(d.notes.some((n) => n.field === "profession")).toBe(false);
  });

  it("dias e horário que faltavam vêm do assistente; preço e duração só valem se o número está na frase", () => {
    const sentence = "barbearia, abro cedinho e fecho no fim da tarde a semana útil, corte 45";
    const rules = describeBusiness(sentence);
    expect(rules.unknown).toEqual(["weekdays", "hours"]);
    const d = mergeAssistantDraft(rules, llm({
      profession: "hairdresser", team_size: 7,
      hours: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start: "08:00", end: "17:00" })),
      services: [{ name: "Corte", duration_min: 30, price_cents: 9900 }],
    }), sentence);
    expect(d.profession).toBe("barber");
    expect(d.team_size).toBeNull();
    expect(win(d)).toEqual(days([1, 2, 3, 4, 5], "08:00-17:00"));
    expect([d.start, d.end]).toEqual(["08:00", "17:00"]);
    expect(d.unknown).toEqual([]);
    expect(d.sources).toMatchObject({ profession: "rules", weekdays: "assistant", hours: "assistant", services: "rules", team_size: null });
    // "Corte" foi lido pelas regras: o preço inventado pelo modelo (99,00) não entra.
    expect(d.service_drafts[0]).toMatchObject({ name: "Corte", price_cents: null, duration_min: 30 });
  });

  it("serviços do assistente: duração do modelo da profissão; valor inventado é descartado, valor dito é mantido", () => {
    const sentence = "sou barbeiro de terça a sábado das 9 às 19, faço degradê por 60";
    const rules = describeBusiness(sentence);
    expect(rules.services).toEqual([]);
    // As regras leram tudo o que é obrigatório: o servidor nem chamaria o modelo. Aqui, a junção com uma resposta dele.
    const d = mergeAssistantDraft(rules, llm({ services: [{ name: "Degradê", duration_min: 25, price_cents: 6000 }, { name: "Barba", duration_min: null, price_cents: 4000 }] }), sentence);
    expect(d.sources.services).toBe("assistant");
    expect(d.service_drafts).toEqual([
      { name: "Degradê", template_code: null, duration_min: null, price_cents: 6000, price_from_cents: null, price_to_cents: null, cited: true },
      { name: "Barba", template_code: "barber_barba", duration_min: 20, price_cents: null, price_from_cents: 2500, price_to_cents: 5000, cited: true },
    ]);
  });

  it("dias lidos pelas regras e horário do assistente: o horário entra só nos dias lidos", () => {
    const sentence = "barbeiro, atendo de terça a sábado, do começo da manhã até a noitinha";
    const rules = describeBusiness(sentence);
    expect(rules.unknown).toEqual(["hours"]);
    const d = mergeAssistantDraft(rules, llm({ hours: [1, 2, 3].map((weekday) => ({ weekday, start: "08:00", end: "19:00" })) }), sentence);
    expect(win(d)).toEqual(days([2, 3, 4, 5, 6], "08:00-19:00"));
    expect(d.sources).toMatchObject({ weekdays: "rules", hours: "assistant" });
  });
});

