// "Descreva seu negócio em uma frase" (P44, docs/12; P50): analisador POR REGRAS, determinístico e sem rede.
// "sou barbeiro, sozinho, de terça a sábado das 9 às 19" → profissão, quantas pessoas, expediente e serviços citados.
// O resultado é um RASCUNHO: a tela mostra cada campo para o dono revisar antes de salvar. O que o analisador não
// entendeu volta em `unknown`, e todo campo recusado ou lido com ressalva volta em `notes`, com o campo e o motivo.
//
// P50 (revisão de 04/11, achado A4): negação ("não atendo domingo e segunda"), dois turnos ("6 às 12 e 17 às 21"),
// dias com horários diferentes ("terça a sexta 10 às 20 e sábado 8 às 16"), travessão ("9h–19h"), "meio-dia",
// "pacote com N sessões" (não é equipe nem serviço de personal) e "a domicílio". Os serviços saem com a duração e a
// faixa de preço do modelo da profissão (templates.ts); preço só quando a frase diz o preço.
//
// O servidor (`setup.describe`) roda estas regras primeiro e só pede ao modelo de linguagem do P46 o que ficou em
// `unknown` (mergeAssistantDraft). Cada campo diz de onde veio em `sources`.
import { z } from "zod";
import { Cents, WeeklyWindow } from "../../contracts/common.ts";
import { type Profession, SetupDescribeDraft } from "../../contracts/index.ts";
import type { BusinessDraft } from "../../llm/tasks/setup.ts";
import { serviceTemplatesOf, templateKey } from "./templates.ts";

/** Campos do rascunho que podem ser recusados, lidos com ressalva ou preenchidos pelo assistente. */
export const DescribeField = z.enum(["profession", "team_size", "weekdays", "hours", "services"]);
export type DescribeField = z.infer<typeof DescribeField>;
/** `rules` = lido pelas regras; `assistant` = preenchido pelo modelo de linguagem; null = não lido. */
export const DescribeSource = z.enum(["rules", "assistant"]);
export type DescribeSource = z.infer<typeof DescribeSource>;

export const DescribeServiceDraft = z.object({
  name: z.string().min(1).max(120),
  /** Modelo da profissão com o mesmo nome (de onde vêm a duração e a faixa); null = serviço sem modelo. */
  template_code: z.string().regex(/^[a-z0-9_]{3,40}$/).nullable(),
  /** Duração dita na frase ou a do modelo; null = o dono informa. */
  duration_min: z.int().min(5).max(1440).nullable(),
  /** Só quando a frase diz o preço. A faixa do modelo é dica, nunca preço. */
  price_cents: Cents.nullable(),
  price_from_cents: Cents.nullable(),
  price_to_cents: Cents.nullable(),
  /** true = citado na frase; false = sugestão do modelo da profissão (a tela mostra desmarcado). */
  cited: z.boolean(),
});
export type DescribeServiceDraft = z.infer<typeof DescribeServiceDraft>;

export const DescribeNote = z.object({
  field: DescribeField,
  /** `refused` = o campo ficou sem valor e o texto diz por quê; `check` = lido com uma suposição que o dono confere. */
  level: z.enum(["refused", "check"]),
  text: z.string().min(1).max(300),
});
export type DescribeNote = z.infer<typeof DescribeNote>;

/** Rascunho completo da frase: o contrato v1 (`SetupDescribeDraft`) mais o expediente por dia, os serviços com modelo e as ressalvas. */
export const BusinessDescription = SetupDescribeDraft.extend({
  /** Expediente inteiro, um bloco por período de cada dia (dois turnos e dias com horários diferentes cabem aqui). */
  windows: z.array(WeeklyWindow).max(50),
  service_drafts: z.array(DescribeServiceDraft).max(20),
  /** "pacote com N sessões": informação para o Caixa; não vira serviço nem equipe. */
  packages: z.array(z.object({ sessions: z.int().min(2).max(100), service: z.string().max(120).nullable() })).max(5),
  /** A frase diz que o atendimento é na casa do cliente. */
  at_home: z.boolean(),
  notes: z.array(DescribeNote).max(20),
  sources: z.object({
    profession: DescribeSource.nullable(), team_size: DescribeSource.nullable(), weekdays: DescribeSource.nullable(),
    hours: DescribeSource.nullable(), services: DescribeSource.nullable(),
  }),
});
export type BusinessDescription = z.infer<typeof BusinessDescription>;

export const SetupDescribeInput = z.object({ sentence: z.string().trim().min(8).max(500) });
/** `assistant`: o modelo de linguagem foi consultado para esta frase (false com LLM_PROVIDER=none ou quando as regras bastaram). */
export const SetupDescribeOutput = BusinessDescription.extend({ assistant: z.boolean() });
export type SetupDescribeOutput = z.infer<typeof SetupDescribeOutput>;

/** Minúsculas, sem acento, espaços simples, travessão como hífen. */
export function normalize(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[‐-―−]/g, "-").replace(/\s+/g, " ").trim();
}

const PROFESSIONS: readonly { re: RegExp; profession: Profession }[] = [
  { re: /\b(barbeir[oa]s?|barbearia|barber)\b/, profession: "barber" },
  { re: /\b(cabeleireir[oa]s?|cabelereir[oa]s?|salao( de beleza)?|hair ?stylist|hairdresser)\b/, profession: "hairdresser" },
  { re: /\b(personal( trainer)?|treinador[a]?|educador[a]? fisic[oa]|professor[a]? de educacao fisica|pilates)\b/, profession: "personal_trainer" },
];

const DAY_RES: readonly RegExp[] = [
  /^(domingos?|dom)$/, /^(segundas?(-feira)?|seg)$/, /^(tercas?(-feira)?|ter)$/, /^(quartas?(-feira)?|qua)$/,
  /^(quintas?(-feira)?|qui)$/, /^(sextas?(-feira)?|sex)$/, /^(sabados?|sab)$/,
];
const DAY = "(?:domingos?|dom|segundas?(?:-feira)?|seg|tercas?(?:-feira)?|ter|quartas?(?:-feira)?|qua|quintas?(?:-feira)?|qui|sextas?(?:-feira)?|sex|sabados?|sab)";
const DAY_NAME = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const dayOf = (word: string): number => DAY_RES.findIndex((re) => re.test(word));

const NUM = "\\d{1,3}|um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|doze";
const NUMBER_WORDS: Record<string, number> = {
  um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, doze: 12,
};
const numberOf = (word: string): number | null => (/^\d+$/.test(word) ? Number(word) : NUMBER_WORDS[word] ?? null);

/** Serviços reconhecidos (vocabulário do piloto). `only` = só conta para estas profissões (ou sem profissão lida). */
const SERVICES: readonly { re: RegExp; name: string; only?: readonly Profession[] }[] = [
  { re: /\bcortes?\b/, name: "Corte" },
  { re: /\bbarbas?\b/, name: "Barba" },
  { re: /\bescovas?\b/, name: "Escova" },
  { re: /\b(coloracao|coloracoes|pintura|tintura)\b/, name: "Coloração" },
  { re: /\b(hidratacao|hidratacoes)\b/, name: "Hidratação" },
  { re: /\bprogressivas?\b/, name: "Progressiva" },
  { re: /\b(luzes|mechas)\b/, name: "Luzes" },
  { re: /\b(sobrancelhas?|design de sobrancelha)\b/, name: "Sobrancelha" },
  { re: /\bpenteados?\b/, name: "Penteado" },
  { re: /\bmaquiagem\b/, name: "Maquiagem" },
  { re: /\bmanicure\b/, name: "Manicure" },
  { re: /\bpedicure\b/, name: "Pedicure" },
  { re: /\bdepilacao\b/, name: "Depilação" },
  { re: /\blimpeza de pele\b/, name: "Limpeza de pele" },
  { re: /\bmassagens?\b/, name: "Massagem" },
  { re: /\b(avaliacao|avaliacoes)( fisicas?)?\b/, name: "Avaliação física", only: ["personal_trainer"] },
  { re: /\b(treinos?|sessao|sessoes|aulas?)\b/, name: "Sessão individual", only: ["personal_trainer"] },
  { re: /\bpilates\b/, name: "Pilates", only: ["personal_trainer"] },
];

/** Trecho [from, to) trocado por espaços: o que já foi lido não é lido de novo, e as posições não mudam. */
const blank = (text: string, from: number, to: number): string => text.slice(0, from) + " ".repeat(to - from) + text.slice(to);

function findProfession(t: string): Profession | null {
  // Primeira ocorrência na frase (quem diz "sou barbeiro e também faço corte feminino" é barbeiro).
  let best: { at: number; profession: Profession } | null = null;
  for (const p of PROFESSIONS) {
    const m = p.re.exec(t);
    if (m && (!best || m.index < best.at)) best = { at: m.index, profession: p.profession };
  }
  return best?.profession ?? null;
}

const PEOPLE = "pessoas|profissionais|barbeir[oa]s|cabeleireir[oa]s|personals|treinador[ae]s|funcionari[oa]s|colaborador[ae]s|socios|socias";
const NOT_PEOPLE = "sessoes|sessao|aulas?|horas?|minutos?|reais|anos?|servicos?|cadeiras?|unidades?|vezes|dias?|clientes?|alun[oa]s?|cortes?|treinos?";

/** Quantas pessoas atendem. `t` já vem sem os trechos de pacote ("pacote com 4 sessões" não é equipe de 4). */
function findTeamSize(t: string): number | null {
  if (/\b(sozinh[oa]|so eu|sou eu|apenas eu|somente eu|autonom[oa])\b/.test(t)) return 1;
  let m = new RegExp(`\\beu e (?:mais )?(${NUM})\\b(?! ?(?:${NOT_PEOPLE})\\b)`).exec(t);
  if (m) {
    const n = numberOf(m[1]!);
    return n === null ? null : n + 1;
  }
  if (/\beu e (?:minha|meu|a|o) \w+/.test(t)) return 2;
  m = new RegExp(`\\b(?:somos|temos|sao|trabalhamos) (?:em )?(${NUM})\\b(?! ?(?:${NOT_PEOPLE})\\b)`).exec(t);
  // "com N" e o número solto só valem com o substantivo de gente depois ("com 3 profissionais").
  m ??= new RegExp(`\\b(${NUM}) (?:${PEOPLE})\\b`).exec(t);
  if (!m) return null;
  const n = numberOf(m[1]!);
  return n !== null && n >= 1 && n <= 50 ? n : null;
}

// ---------------------------------------------------------------- horário

type Range = { start: string; end: string };
type Period = "manha" | "tarde" | "noite" | undefined;
interface TimeToken { hour: number; minute: number; period: Period; noon: boolean }

// Quatro grupos: hora, minutos, período do dia, "meio-dia".
const TIME = "(?:(\\d{1,2})(?!\\d)(?:(?::|h)(\\d{2}))?(?: ?(?:horas?|hrs?|hs|h)\\b)?(?: ?(?:da|de) (manha|tarde|noite))?|(meio[- ]dia))";
const NOT_TIME = "(?! ?(?:sessoes|sessao|pessoas|clientes|reais|minutos|min\\b|anos|vezes|aulas|alun[oa]s|cortes|profissionais)\\b)";

function timeToken(m: RegExpExecArray, at: number): TimeToken | null {
  if (m[at + 3]) return { hour: 12, minute: 0, period: undefined, noon: true };
  const hour = Number(m[at]);
  const minute = m[at + 1] ? Number(m[at + 1]) : 0;
  if (!Number.isInteger(hour) || hour > 23 || minute > 59) return null;
  return { hour, minute, period: m[at + 2] as Period, noon: false };
}
const fmt = (hour: number, minute: number) => `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
const hourOf = (t: TimeToken, afterNoon = false): number => ((t.period === "tarde" || t.period === "noite" || afterNoon) && t.hour < 12 ? t.hour + 12 : t.hour);
const explicit = (t: TimeToken) => t.noon || t.period !== undefined || t.hour >= 12;

/** "9", "9h", "9:30", "9h30", "19", "7 da noite", "meio-dia" → intervalo válido, ou null. */
function toRange(a: TimeToken, b: TimeToken): { range: Range; assumedPm: boolean } | null {
  let sh = hourOf(a);
  let eh = hourOf(b);
  let assumedPm = false;
  // "das 9 às 7" (sem "da noite"): o fim menor que o início é da tarde.
  if (fmt(eh, b.minute) <= fmt(sh, a.minute) && !explicit(b)) eh = hourOf(b, true);
  // "das 2 às 6", sem dizer o período: ninguém abre às 2 da manhã; lemos 14 às 18 e avisamos.
  if (sh >= 1 && sh <= 4 && eh <= 11 && !explicit(a) && !explicit(b)) {
    sh += 12;
    eh += 12;
    assumedPm = true;
  }
  if (sh > 23 || eh > 23) return null;
  const range = { start: fmt(sh, a.minute), end: fmt(eh, b.minute) };
  return range.end > range.start ? { range, assumedPm } : null;
}

/** Une blocos que se tocam ou se sobrepõem. */
function mergeRanges(ranges: readonly Range[]): Range[] {
  const sorted = [...ranges].sort((a, b) => a.start.localeCompare(b.start));
  const out: Range[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end) last.end = r.end > last.end ? r.end : last.end;
    else out.push({ ...r });
  }
  return out;
}

const splitAtPause = (ranges: readonly Range[], pause: Range | null): Range[] =>
  pause ? ranges.flatMap((r) => (pause.start > r.start && pause.end < r.end ? [{ start: r.start, end: pause.start }, { start: pause.end, end: r.end }] : [r])) : [...ranges];

const rangeText = (ranges: readonly Range[]) => ranges.map((r) => `${r.start} às ${r.end}`).join(" e ");

/** "terça a sábado", "segunda, quarta e sexta", "todos os dias". */
export function daysText(days: readonly number[]): string {
  const d = [...new Set(days)].sort((a, b) => a - b);
  if (d.length === 0) return "nenhum dia";
  if (d.length === 7) return "todos os dias";
  const names = d.map((x) => DAY_NAME[x]!);
  const consecutive = d.every((x, i) => i === 0 || x === d[i - 1]! + 1);
  if (consecutive && d.length > 2) return `${names[0]} a ${names[names.length - 1]}`;
  return names.length === 1 ? names[0]! : `${names.slice(0, -1).join(", ")} e ${names[names.length - 1]}`;
}

interface DayExpr { kind: "days"; at: number; end: number; days: number[]; negated: boolean; onlyTer: boolean }
interface RangeItem { kind: "range"; at: number; end: number; range: Range }
interface OpenEnd { kind: "open"; at: number; end: number; time: TimeToken }
type Item = DayExpr | RangeItem | OpenEnd;

const NEG_BEFORE = /\b(?:nao (?:atendo|atendemos|atende|trabalho|trabalhamos|abro|abrimos|abre|funciono|funciona|funcionamos)|menos|exceto|tirando|folgas?|fecho|fechamos|fechad[oa]s?|descanso|sem atender)\b/;
const NEG_AFTER = /^,? ?(?:eu )?(?:(?:e|sao|fica|ficam) )?(?:nao (?:atendo|atendemos|trabalho|trabalhamos|abro|abrimos|funciono|funciona)|(?:de )?folga|fechad[oa]s?|descanso)\b/;
const LIST_GAP = /^(?:, ?e |, ?| e (?:tambem )?(?:(?:aos?|as|nos?|nas?|de|em) )?| ?\/ ?| ?\+ ?|,? nem (?:(?:aos?|as|nos?|nas?|de) )?)$/;

function findDayExprs(t: string): DayExpr[] {
  const element = new RegExp(
    `\\b(?:(todos os dias|todo dia|todo o dia|todo santo dia|a semana inteira|a semana toda|sem folga)|(dias uteis)|((?:fim|final|fins|finais) de semana)` +
    `|(?:de |da |das |do )?(${DAY}) ?(?:a|ate|-|as|ao)(?: a| o)? ?(${DAY})|(${DAY}))\\b`, "g");
  const parts: { at: number; end: number; days: number[]; ter: boolean; range: boolean }[] = [];
  let m: RegExpExecArray | null;
  while ((m = element.exec(t))) {
    let days: number[];
    let ter = false;
    const range = !!(m[4] && m[5]);
    if (m[1]) days = ALL_DAYS;
    else if (m[2]) days = [1, 2, 3, 4, 5];
    else if (m[3]) days = [0, 6];
    else if (m[4] && m[5]) {
      const from = dayOf(m[4]);
      const to = dayOf(m[5]);
      days = [];
      // "de domingo a domingo" é a semana inteira.
      if (from === to) days = ALL_DAYS;
      else for (let d = from; ; d = (d + 1) % 7) { days.push(d); if (d === to) break; }
    } else {
      days = [dayOf(m[6]!)];
      ter = m[6] === "ter";
    }
    parts.push({ at: m.index, end: m.index + m[0].length, days, ter, range });
  }
  // "segunda, quarta e sexta" e "segunda a sexta e sábado" são uma expressão só. Um intervalo depois de vírgula começa
  // outra ("não atendo domingo e segunda, terça a sexta das 10 às 20": a negação não alcança o intervalo).
  const exprs: DayExpr[] = [];
  for (const p of parts) {
    const last = exprs[exprs.length - 1];
    const gap = last ? t.slice(last.end, p.at) : "";
    if (last && LIST_GAP.test(gap) && !(p.range && /^, ?$/.test(gap))) {
      last.end = p.end;
      last.days = [...new Set([...last.days, ...p.days])];
      last.onlyTer = false;
    } else exprs.push({ kind: "days", at: p.at, end: p.end, days: [...p.days], negated: false, onlyTer: p.ter });
  }
  // "ter" sozinho é quase sempre o verbo ("quero ter mais clientes"): só vale em lista ou intervalo ("seg, ter e qua").
  return exprs.filter((e) => !e.onlyTer);
}

interface Hours {
  /** Blocos por dia da semana, já com a pausa aplicada. */
  byDay: Map<number, Range[]>;
  /** Horário lido sem dia nenhum ("das 9 às 19"): entra no resumo, mas não vira expediente. */
  loose: Range[];
  pause: Range | null;
  notes: DescribeNote[];
}

function findHours(t: string, quote: (from: number, to: number) => string): Hours {
  const notes: DescribeNote[] = [];
  let rest = t;

  // Pausa primeiro, para tirá-la da frase antes de procurar o expediente.
  let pause: Range | null = null;
  const pm = new RegExp(`\\b(?:almoco|pausa|intervalo)(?: de| das| do| entre)?(?: as)? ${TIME} (?:as|a|ate as|ate|ao|e) ${TIME}`).exec(rest);
  if (pm) {
    const a = timeToken(pm, 1);
    const b = timeToken(pm, 5);
    const r = a && b ? toRange(a, b) : null;
    if (r) pause = r.range;
    rest = blank(rest, pm.index, pm.index + pm[0].length);
  }

  const items: Item[] = findDayExprs(rest);
  for (const e of items) rest = blank(rest, e.at, e.end);

  // Intervalos: "das 9 às 19", "9h-19h", "de 9 a 19", "entre 8 e 12", "das 10 ao meio-dia".
  const rangeRe = new RegExp(`\\b(entre(?: as)? )?(?:(?:das|de|do|da|desde)(?: as)? )?${TIME} ?(as|a|ate as|ate|ao|e|-) ?${TIME}${NOT_TIME}`, "g");
  let m: RegExpExecArray | null;
  const refused: string[] = [];
  let assumedPm: string | null = null;
  while ((m = rangeRe.exec(rest))) {
    // "9 e 10" só é intervalo com "entre".
    if (m[6] === "e" && !m[1]) { rangeRe.lastIndex = m.index + 1; continue; }
    const a = timeToken(m, 2);
    const b = timeToken(m, 7);
    const end = m.index + m[0].length;
    const r = a && b ? toRange(a, b) : null;
    if (r) {
      items.push({ kind: "range", at: m.index, end, range: r.range });
      if (r.assumedPm) assumedPm = `${quote(m.index, end)} (li ${r.range.start} às ${r.range.end})`;
    } else refused.push(quote(m.index, end));
    rest = blank(rest, m.index, end);
    rangeRe.lastIndex = end;
  }
  // "sábado até as 14h": só o fim; o início vem do horário dos outros dias.
  const openRe = new RegExp(`\\b(?:so )?ate(?: as| o| ao)? ${TIME}${NOT_TIME}`, "g");
  while ((m = openRe.exec(rest))) {
    const time = timeToken(m, 1);
    const end = m.index + m[0].length;
    if (time) items.push({ kind: "open", at: m.index, end, time });
    rest = blank(rest, m.index, end);
  }
  items.sort((x, y) => x.at - y.at);

  // Negação: "não atendo domingo e segunda", "menos quinta", "segunda é folga".
  const boundary = (at: number) => {
    let b = Math.max(t.lastIndexOf(".", at - 1), t.lastIndexOf(";", at - 1), t.lastIndexOf("!", at - 1), -1) + 1;
    for (const it of items) if (it.end <= at && it.end > b) b = it.end;
    return b;
  };
  const exprs = items.filter((it): it is DayExpr => it.kind === "days");
  for (const e of exprs) {
    const next = items.find((it) => it.at >= e.end);
    const after = t.slice(e.end, Math.min(next ? next.at : t.length, e.end + 30));
    e.negated = NEG_BEFORE.test(t.slice(boundary(e.at), e.at).slice(-32)) || NEG_AFTER.test(after);
  }

  // Cada horário pertence aos dias citados antes dele; horário antes de qualquer dia (ou depois de uma negação) vale
  // para os dias que ficarem sem horário próprio.
  interface Group { days: number[]; ranges: Range[]; open: TimeToken | null; text: string }
  const groups: Group[] = [];
  const floating: Range[] = [];
  const negated = new Set<number>();
  let current: Group | null = null;
  for (const it of items) {
    if (it.kind === "days") {
      if (it.negated) {
        for (const d of it.days) negated.add(d);
        current = null;
      } else {
        current = { days: it.days, ranges: [], open: null, text: quote(it.at, it.end) };
        groups.push(current);
      }
    } else if (it.kind === "range") {
      const target = current ? current.ranges : floating;
      const prev = target[target.length - 1];
      let r = it.range;
      // "das 8 ao meio-dia e das 2 às 6": o segundo turno, menor que o fim do primeiro, é da tarde.
      if (prev && r.start < prev.end && Number(r.end.slice(0, 2)) < 12) {
        const shifted = { start: fmt(Number(r.start.slice(0, 2)) + 12, Number(r.start.slice(3))), end: fmt(Number(r.end.slice(0, 2)) + 12, Number(r.end.slice(3))) };
        if (shifted.start >= prev.end) r = shifted;
      }
      target.push(r);
    } else if (current) current.open = it.time;
    else notes.push({ field: "hours", level: "check", text: `Não usei este trecho: “${quote(it.at, it.end)}”. Diga também o início, ou ajuste abaixo.` });
  }

  const firstWithRanges = groups.find((g) => g.ranges.length > 0);
  for (const g of groups) {
    if (g.ranges.length > 0) continue;
    if (floating.length > 0) g.ranges = [...floating];
    else if (g.open && firstWithRanges) {
      const start = firstWithRanges.ranges[0]!.start;
      const end = fmt(hourOf(g.open, !explicit(g.open) && fmt(g.open.hour, g.open.minute) <= start), g.open.minute);
      if (end > start) g.ranges = [{ start, end }];
    } else if (firstWithRanges) {
      g.ranges = [...firstWithRanges.ranges];
      notes.push({ field: "hours", level: "check", text: `A frase não diz o horário de ${daysText(g.days)}: usei o mesmo de ${daysText(firstWithRanges.days)}. Confira.` });
    }
  }
  if (floating.length > 0 && groups.length > 0 && groups.every((g) => g.ranges !== floating && rangeText(g.ranges) !== rangeText(floating))) {
    notes.push({ field: "hours", level: "check", text: `Não usei este horário: ${rangeText(floating)}. Os dias citados já têm horário próprio.` });
  }

  const byDay = new Map<number, Range[]>();
  if (groups.length === 0 && negated.size > 0) {
    // Só a negação: os outros dias da semana, com o horário solto.
    const days = ALL_DAYS.filter((d) => !negated.has(d));
    for (const d of days) byDay.set(d, floating);
    notes.push({ field: "weekdays", level: "check", text: `Você disse que não atende ${daysText([...negated])}: marquei ${daysText(days)}. Confira.` });
  } else {
    // O dia citado por último vale ("terça a sábado das 9 às 19, sábado das 9 às 14").
    for (const g of groups) for (const d of g.days) if (!negated.has(d)) byDay.set(d, g.ranges);
    const removed = [...negated].filter((d) => groups.some((g) => g.days.includes(d)));
    if (removed.length > 0) notes.push({ field: "weekdays", level: "check", text: `Você disse que não atende ${daysText(removed)}: tirei ${removed.length > 1 ? "esses dias" : "esse dia"}. Confira.` });
  }
  for (const [d, ranges] of byDay) byDay.set(d, mergeRanges(splitAtPause(mergeRanges(ranges), pause)));

  const signatures = new Set([...byDay.values()].filter((r) => r.length > 0).map(rangeText));
  if (signatures.size > 1) {
    const main = mainSchedule(byDay);
    const others = [...byDay.entries()].filter(([, r]) => r.length > 0 && rangeText(r) !== rangeText(main));
    const bySig = new Map<string, number[]>();
    for (const [d, r] of others) bySig.set(rangeText(r), [...(bySig.get(rangeText(r)) ?? []), d]);
    notes.push({ field: "hours", level: "check", text: `Horários diferentes por dia: ${[...bySig.entries()].map(([sig, days]) => `${daysText(days)}, ${sig}`).join("; ")}. Confira.` });
  } else if ([...byDay.values()].some((r) => r.length > 1) && !pause) {
    const two = [...byDay.values()].find((r) => r.length > 1)!;
    notes.push({ field: "hours", level: "check", text: `Li ${two.length === 2 ? "dois" : String(two.length)} períodos por dia: ${rangeText(two)}. Confira.` });
  }
  if (assumedPm) notes.push({ field: "hours", level: "check", text: `Entendi que é à tarde: ${assumedPm}. Confira.` });
  for (const r of refused) notes.push({ field: "hours", level: "refused", text: `Não usei o horário “${r}”: o fim precisa vir depois do início.` });
  // Hora que sobrou sem par ("abro às 9"): avisa em vez de ignorar.
  const left = /\b(?:as |a partir d[ae]s? )?\d{1,2}(?:h\d{0,2}|:\d{2})\b|\ba partir d[ae]s? \d{1,2}\b/.exec(rest);
  if (left) notes.push({ field: "hours", level: "check", text: `Não usei este trecho: “${quote(left.index, left.index + left[0].length)}”. Um horário precisa de início e fim.` });

  return { byDay, loose: mergeRanges(splitAtPause(mergeRanges(floating), pause)), pause, notes };
}

/** O horário que mais dias compartilham (empate: o do primeiro dia da semana). */
function mainSchedule(byDay: ReadonlyMap<number, Range[]>): Range[] {
  const count = new Map<string, { n: number; ranges: Range[] }>();
  for (const d of [...byDay.keys()].sort((a, b) => a - b)) {
    const ranges = byDay.get(d)!;
    if (ranges.length === 0) continue;
    const c = count.get(rangeText(ranges)) ?? { n: 0, ranges };
    c.n += 1;
    count.set(rangeText(ranges), c);
  }
  let best: { n: number; ranges: Range[] } | null = null;
  for (const c of count.values()) if (!best || c.n > best.n) best = c;
  return best?.ranges ?? [];
}

/** Campos resumidos do contrato v1 (início, fim e pausa do horário principal) a partir dos blocos. */
function summarize(ranges: readonly Range[], explicitPause: Range | null): Pick<BusinessDescription, "start" | "end" | "pause"> {
  if (ranges.length === 0) return { start: null, end: null, pause: explicitPause };
  const gap = ranges.length === 2 ? { start: ranges[0]!.end, end: ranges[1]!.start } : null;
  return { start: ranges[0]!.start, end: ranges[ranges.length - 1]!.end, pause: explicitPause ?? gap };
}

function toWindows(byDay: ReadonlyMap<number, Range[]>): WeeklyWindow[] {
  return [...byDay.keys()].sort((a, b) => a - b)
    .flatMap((weekday) => byDay.get(weekday)!.map((r) => ({ weekday, local_start: r.start, local_end: r.end })))
    .slice(0, 50);
}

// ---------------------------------------------------------------- serviços e pacotes

interface Found { packages: BusinessDescription["packages"]; cited: { name: string; duration_min: number | null; price_cents: number | null }[]; rest: string }

function findServices(t: string, profession: Profession | null): Found {
  let rest = t;
  const packages: BusinessDescription["packages"] = [];
  const cited: Found["cited"] = [];
  const allowed = (s: (typeof SERVICES)[number]) => !s.only || profession === null || s.only.includes(profession);
  const add = (name: string, duration_min: number | null = null, price_cents: number | null = null) => {
    const prior = cited.find((c) => c.name === name);
    if (!prior) cited.push({ name, duration_min, price_cents });
    else {
      prior.duration_min ??= duration_min;
      prior.price_cents ??= price_cents;
    }
  };
  const serviceIn = (text: string) => SERVICES.find((s) => allowed(s) && s.name !== "Sessão individual" && s.re.test(text))?.name ?? null;

  // "pacote de 10 sessões", "pacote com 4 cortes", "pacote de hidratação com 4 sessões".
  const packRe = new RegExp(`\\bpacotes?(?: mensal| mensais)?(?: (?:de|com))? (?:(${NUM}) ([a-z]+)|([a-z][a-z ]{2,40}?) (?:com|de) (${NUM}) ([a-z]+))`, "g");
  let m: RegExpExecArray | null;
  while ((m = packRe.exec(t))) {
    const sessions = numberOf((m[1] ?? m[4])!);
    const service = serviceIn(m[3] ?? m[2] ?? "");
    if (sessions !== null && sessions >= 2 && sessions <= 100 && packages.length < 5) {
      // Pacote de sessões do personal se vende sobre a sessão avulsa.
      const base = service ?? (profession === "personal_trainer" ? "Sessão individual" : null);
      packages.push({ sessions, service: base });
      if (base) add(base);
    }
    rest = blank(rest, m.index, m.index + m[0].length);
  }

  // Serviços citados, com a duração e o preço ditos logo depois ("corte 30 minutos por 50 reais").
  const hits: { at: number; end: number; name: string }[] = [];
  for (const s of SERVICES) {
    if (!allowed(s)) continue;
    const re = new RegExp(s.re.source, "g");
    while ((m = re.exec(rest))) hits.push({ at: m.index, end: m.index + m[0].length, name: s.name });
  }
  hits.sort((a, b) => a.at - b.at);
  const details = new Map<string, { duration_min: number | null; price_cents: number | null }>();
  hits.forEach((h, i) => {
    const stop = Math.min(hits[i + 1]?.at ?? rest.length, h.end + 45);
    const tail = rest.slice(h.end, stop).split(/[.;]/)[0]!;
    const d = /\b(\d{1,3}) ?(?:min\b|minutos?)|\b(\d) ?horas?\b(?! ?(?:as|a|ate)\b)|\b(meia hora)\b/.exec(tail);
    const p = /r\$ ?(\d{1,5})(?:,(\d{2}))?|\b(\d{1,5})(?:,(\d{2}))? ?(?:reais|real)\b/.exec(tail);
    const duration = d ? (d[1] ? Number(d[1]) : d[2] ? Number(d[2]) * 60 : 30) : null;
    const price = p ? Number(p[1] ?? p[3]) * 100 + Number(p[2] ?? p[4] ?? 0) : null;
    const prior = details.get(h.name) ?? { duration_min: null, price_cents: null };
    details.set(h.name, {
      duration_min: prior.duration_min ?? (duration !== null && duration >= 5 && duration <= 1440 ? duration : null),
      price_cents: prior.price_cents ?? price,
    });
  });
  // A ordem de saída é a do vocabulário (estável para a tela e para os testes).
  for (const s of SERVICES) {
    const d = details.get(s.name);
    if (d) add(s.name, d.duration_min, d.price_cents);
  }
  const order = (name: string) => SERVICES.findIndex((s) => s.name === name);
  cited.sort((a, b) => order(a.name) - order(b.name));
  return { packages, cited: cited.slice(0, 20), rest };
}

/** Serviços do rascunho com a duração e a faixa do modelo da profissão; sem serviço citado, sugere os modelos. */
function serviceDrafts(cited: Found["cited"], profession: Profession | null): DescribeServiceDraft[] {
  const templates = serviceTemplatesOf(profession);
  if (cited.length === 0) {
    return templates.map((t) => ({
      name: t.name, template_code: t.code, duration_min: t.duration_min, price_cents: null,
      price_from_cents: t.price_from_cents, price_to_cents: t.price_to_cents, cited: false,
    }));
  }
  return cited.map((c) => {
    const t = templates.find((x) => templateKey(x.name) === templateKey(c.name));
    return {
      name: c.name, template_code: t?.code ?? null, duration_min: c.duration_min ?? t?.duration_min ?? null, price_cents: c.price_cents,
      price_from_cents: t?.price_from_cents ?? null, price_to_cents: t?.price_to_cents ?? null, cited: true,
    };
  });
}

const AT_HOME = /\b(?:a|em|no|ao) domicilio\b|\bdomiciliar(?:es)?\b|\bna casa d[oa]s? (?:clientes?|alun[oa]s?)\b|\bvou ate (?:o|a|os|as) (?:clientes?|alun[oa]s?)\b/;

const UNKNOWN_REASON: Record<BusinessDescription["unknown"][number], string> = {
  profession: "Não encontrei a profissão na frase. Escolha abaixo.",
  weekdays: "Não encontrei os dias de atendimento na frase. Marque abaixo.",
  hours: "Não encontrei um horário com início e fim na frase. Informe abaixo.",
};

function finish(d: Omit<BusinessDescription, "unknown" | "sources"> & { sources?: Partial<BusinessDescription["sources"]> }): BusinessDescription {
  const unknown: BusinessDescription["unknown"] = [];
  if (!d.profession) unknown.push("profession");
  if (d.weekdays.length === 0) unknown.push("weekdays");
  if (!d.start || !d.end) unknown.push("hours");
  // Todo campo sem valor tem um motivo com o nome do campo; se já há uma recusa específica, ela basta. O motivo genérico
  // de um campo que passou a ter valor (preenchido pelo assistente) sai.
  const generic = new Set(Object.values(UNKNOWN_REASON));
  const notes = d.notes.filter((n) => !(n.level === "refused" && generic.has(n.text)));
  for (const u of unknown) if (!notes.some((n) => n.field === u && n.level === "refused")) notes.push({ field: u, level: "refused", text: UNKNOWN_REASON[u] });
  const rules = (known: boolean): DescribeSource | null => (known ? "rules" : null);
  return {
    ...d, notes: notes.slice(0, 20), unknown,
    sources: {
      profession: d.sources?.profession ?? rules(d.profession !== null),
      team_size: d.sources?.team_size ?? rules(d.team_size !== null),
      weekdays: d.sources?.weekdays ?? rules(d.weekdays.length > 0),
      hours: d.sources?.hours ?? rules(d.start !== null && d.end !== null),
      services: d.sources?.services ?? rules(d.service_drafts.some((s) => s.cited)),
    },
  };
}

/** Lê a frase e devolve o rascunho. Nunca lança: frase vazia devolve tudo nulo, `unknown` completo e o motivo de cada campo. */
export function describeBusiness(sentence: string): BusinessDescription {
  const clean = (sentence ?? "").normalize("NFC").replace(/\s+/g, " ").trim();
  const t = normalize(clean);
  // Trecho como o dono escreveu (com acento) quando as posições batem; senão, o texto normalizado.
  const quote = (from: number, to: number) => (t.length === clean.length ? clean : t).slice(from, to).trim();
  const profession = findProfession(t);
  const found = findServices(t, profession);
  const hours = findHours(found.rest, quote);
  const weekdays = [...hours.byDay.keys()].sort((a, b) => a - b);
  const windows = toWindows(hours.byDay);
  const main = windows.length > 0 ? mainSchedule(hours.byDay) : hours.loose;
  return finish({
    profession,
    team_size: findTeamSize(found.rest),
    weekdays,
    ...summarize(main, hours.pause),
    services: found.cited.map((c) => c.name),
    windows,
    service_drafts: serviceDrafts(found.cited, profession),
    packages: found.packages,
    at_home: AT_HOME.test(t),
    notes: hours.notes,
  });
}

/** Expediente semanal a partir do resumo do rascunho: um bloco por dia, dividido na pausa quando houver. */
export function draftToWeeklyWindows(draft: Pick<SetupDescribeDraft, "weekdays" | "start" | "end" | "pause">): { weekday: number; local_start: string; local_end: string }[] {
  if (!draft.start || !draft.end) return [];
  const out: { weekday: number; local_start: string; local_end: string }[] = [];
  for (const weekday of draft.weekdays) {
    const p = draft.pause;
    if (p && p.start > draft.start && p.end < draft.end) {
      out.push({ weekday, local_start: draft.start, local_end: p.start }, { weekday, local_start: p.end, local_end: draft.end });
    } else {
      out.push({ weekday, local_start: draft.start, local_end: draft.end });
    }
  }
  return out;
}

/**
 * Completa com a leitura do modelo de linguagem (P46) SÓ o que as regras deixaram sem ler. O que as regras leram não
 * muda. Duração e preço vindos do modelo só valem se o número está na frase (o modelo não inventa valor); a duração que
 * falta vem do modelo de serviço da profissão. Cada campo preenchido aqui sai com `sources.<campo> = "assistant"`.
 */
export function mergeAssistantDraft(draft: BusinessDescription, llm: BusinessDraft | null, sentence: string): BusinessDescription {
  if (!llm) return draft;
  const numbers = new Set(normalize(sentence).match(/\d+/g) ?? []);
  const said = (n: number | null) => n !== null && numbers.has(String(n));
  const sources: Partial<BusinessDescription["sources"]> = { ...draft.sources };
  const next = { ...draft };

  if (!draft.profession && llm.profession) {
    next.profession = llm.profession;
    sources.profession = "assistant";
  }
  if (draft.team_size === null && llm.team_size !== null && said(llm.team_size)) {
    next.team_size = llm.team_size;
    sources.team_size = "assistant";
  }
  const noDays = draft.weekdays.length === 0;
  const noHours = !draft.start || !draft.end;
  if ((noDays || noHours) && llm.hours.length > 0) {
    // Dias que as regras leram continuam valendo: do modelo entra só o horário desses dias.
    const usable = llm.hours.filter((h) => noDays || draft.weekdays.includes(h.weekday));
    const byDay = new Map<number, Range[]>();
    // Horário que as regras leram (sem dia) vale para os dias que o modelo leu; senão, o horário é o do modelo.
    const fixed = noHours ? null : [{ start: draft.start!, end: draft.end! }];
    for (const h of usable) byDay.set(h.weekday, fixed ?? [...(byDay.get(h.weekday) ?? []), { start: h.start, end: h.end }]);
    for (const [d, r] of byDay) byDay.set(d, mergeRanges(splitAtPause(mergeRanges(r), draft.pause)));
    if (byDay.size > 0) {
      // Dia lido pelas regras que o modelo não citou fica com o horário principal do modelo.
      if (!noDays) for (const d of draft.weekdays) if (!byDay.has(d)) byDay.set(d, mainSchedule(byDay));
      next.weekdays = [...byDay.keys()].sort((a, b) => a - b);
      next.windows = toWindows(byDay);
      Object.assign(next, summarize(mainSchedule(byDay), draft.pause));
      if (noDays) sources.weekdays = "assistant";
      if (noHours) sources.hours = "assistant";
    }
  }
  if (!draft.service_drafts.some((s) => s.cited) && llm.services.length > 0) {
    const cited = llm.services.slice(0, 20).map((s) => ({
      name: s.name.trim(), duration_min: said(s.duration_min) ? s.duration_min : null,
      price_cents: s.price_cents !== null && said(Math.floor(s.price_cents / 100)) ? s.price_cents : null,
    }));
    next.services = cited.map((c) => c.name);
    next.service_drafts = serviceDrafts(cited, next.profession);
    sources.services = "assistant";
  } else if (sources.profession === "assistant") {
    // A profissão veio do modelo: os serviços ganham a duração e a faixa dos modelos dessa profissão.
    next.service_drafts = serviceDrafts(draft.service_drafts.filter((s) => s.cited).map((s) => ({ name: s.name, duration_min: null, price_cents: s.price_cents })), next.profession);
  }
  const { unknown: _u, sources: _s, ...rest } = next;
  return finish({ ...rest, sources });
}
