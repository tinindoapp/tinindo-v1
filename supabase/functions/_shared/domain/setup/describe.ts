// "Descreva seu negócio em uma frase" (P44, docs/12): analisador POR REGRAS, determinístico e sem rede.
// "sou barbeiro, sozinho, de terça a sábado das 9 às 19" → profissão, quantas pessoas, dias, horário, pausa e serviços
// citados. O resultado é um RASCUNHO: a tela mostra cada campo para o dono revisar antes de salvar, e o que o analisador
// não entendeu volta em `unknown` para a tela perguntar. Quando o P46 entrar, o modelo devolve este mesmo formato.
import type { SetupDescribeDraft } from "../../contracts/setup.ts";

type Profession = NonNullable<SetupDescribeDraft["profession"]>;

/** Minúsculas, sem acento, espaços simples. */
export function normalize(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

const PROFESSIONS: readonly { re: RegExp; profession: Profession }[] = [
  { re: /\b(barbeir[oa]s?|barbearia|barber)\b/, profession: "barber" },
  { re: /\b(cabeleireir[oa]s?|cabelereir[oa]s?|salao( de beleza)?|hair ?stylist|hairdresser)\b/, profession: "hairdresser" },
  { re: /\b(personal( trainer)?|treinador[a]?|educador[a]? fisic[oa]|professor[a]? de educacao fisica|pilates)\b/, profession: "personal_trainer" },
];

const WEEKDAYS: readonly { re: RegExp; day: number }[] = [
  { re: /\b(domingos?|dom)\b/, day: 0 },
  { re: /\b(segundas?(-feira)?|seg)\b/, day: 1 },
  { re: /\b(tercas?(-feira)?|ter)\b/, day: 2 },
  { re: /\b(quartas?(-feira)?|qua)\b/, day: 3 },
  { re: /\b(quintas?(-feira)?|qui)\b/, day: 4 },
  { re: /\b(sextas?(-feira)?|sex)\b/, day: 5 },
  { re: /\b(sabados?|sab)\b/, day: 6 },
];
const WEEKDAY_WORD = "(?:domingos?|dom|segundas?(?:-feira)?|seg|tercas?(?:-feira)?|ter|quartas?(?:-feira)?|qua|quintas?(?:-feira)?|qui|sextas?(?:-feira)?|sex|sabados?|sab)";

const NUMBER_WORDS: Record<string, number> = {
  um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10,
};
const numberOf = (word: string): number | null => (/^\d+$/.test(word) ? Number(word) : NUMBER_WORDS[word] ?? null);

/** Serviços reconhecidos (vocabulário do piloto: beleza, barbearia e personal). O dono adiciona o resto na tela. */
const SERVICES: readonly { re: RegExp; name: string }[] = [
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
  { re: /\b(avaliacao|avaliacoes)( fisicas?)?\b/, name: "Avaliação física" },
  { re: /\b(treinos?|sessao|sessoes)\b/, name: "Sessão individual" },
  { re: /\bpilates\b/, name: "Pilates" },
];

function findProfession(t: string): Profession | null {
  // Primeira ocorrência na frase (quem diz "sou barbeiro e também faço corte feminino" é barbeiro).
  let best: { at: number; profession: Profession } | null = null;
  for (const p of PROFESSIONS) {
    const m = p.re.exec(t);
    if (m && (!best || m.index < best.at)) best = { at: m.index, profession: p.profession };
  }
  return best?.profession ?? null;
}

function findTeamSize(t: string): number | null {
  if (/\b(sozinh[oa]|so eu|sou eu|apenas eu|somente eu)\b/.test(t)) return 1;
  let m = /\beu e (?:mais )?(\d+|um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez)\b/.exec(t);
  if (m) {
    const n = numberOf(m[1]!);
    return n === null ? null : n + 1;
  }
  if (/\beu e (?:minha|meu|a|o) \w+/.test(t)) return 2;
  m = /\b(?:somos|temos|com|sao) (?:em )?(\d+|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez)(?: pessoas| profissionais| barbeir[oa]s| cabeleireir[oa]s| personals| treinador[ae]s)?\b/.exec(t);
  if (m) return numberOf(m[1]!);
  m = /\b(\d+|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez) (?:pessoas|profissionais|barbeir[oa]s|cabeleireir[oa]s|personals|treinador[ae]s)\b/.exec(t);
  if (m) return numberOf(m[1]!);
  return null;
}

const dayOf = (word: string): number => WEEKDAYS.find((w) => w.re.test(word))!.day;

function findWeekdays(t: string): number[] {
  if (/\b(todos os dias|todo dia|todo o dia|a semana inteira|sem folga)\b/.test(t)) return [0, 1, 2, 3, 4, 5, 6];
  const days = new Set<number>();
  // "de terça a sábado", "segunda até sexta", "seg-sex".
  const range = new RegExp(`\\b(?:de |da |das )?(${WEEKDAY_WORD})(?:-feira)? ?(?:a|ate|até|-|as|à)(?: a)? ?(${WEEKDAY_WORD})\\b`, "g");
  let m: RegExpExecArray | null;
  let any = false;
  while ((m = range.exec(t))) {
    any = true;
    const from = dayOf(m[1]!);
    const to = dayOf(m[2]!);
    for (let d = from; ; d = (d + 1) % 7) {
      days.add(d);
      if (d === to) break;
    }
  }
  if (/\bdias uteis\b/.test(t)) { any = true; for (const d of [1, 2, 3, 4, 5]) days.add(d); }
  if (/\b(fim|final) de semana\b/.test(t) || /\bfins de semana\b/.test(t)) { any = true; days.add(6); days.add(0); }
  // Dias soltos: "segunda, quarta e sexta". Só quando não há intervalo, para "de terça a sábado" não virar só ter+sáb.
  if (!any) {
    const single = new RegExp(`\\b(${WEEKDAY_WORD})\\b`, "g");
    while ((m = single.exec(t))) days.add(dayOf(m[1]!));
  }
  return [...days].sort((a, b) => a - b);
}

/** "9", "9h", "9:30", "9h30", "19", "7 da noite" → "HH:MM" (ou null). */
function hhmm(hour: string, minute: string | undefined, period: string | undefined, afterNoonHint: boolean): string | null {
  let h = Number(hour);
  const min = minute ? Number(minute) : 0;
  if (!Number.isInteger(h) || h < 0 || h > 23 || min < 0 || min > 59) return null;
  if ((period === "tarde" || period === "noite" || afterNoonHint) && h < 12) h += 12;
  if (h > 23) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

const TIME = "(\\d{1,2})(?:[:h](\\d{2}))?h?(?: ?(?:da|de) (manha|tarde|noite))?";

function findHours(t: string): { start: string | null; end: string | null; pause: { start: string; end: string } | null } {
  const text = t.replace(/\b(as|às)\b/g, "as");
  // Pausa primeiro, para tirá-la da frase antes de procurar o expediente.
  let pause: { start: string; end: string } | null = null;
  const pauseRe = new RegExp(`\\b(?:almoco|pausa|intervalo)(?: de| das| de)? ${TIME} (?:as|a|ate) ${TIME}`);
  const pm = pauseRe.exec(text);
  let rest = text;
  if (pm) {
    const s = hhmm(pm[1]!, pm[2], pm[3], false);
    const e = hhmm(pm[4]!, pm[5], pm[6], false);
    if (s && e && e > s) pause = { start: s, end: e };
    rest = text.slice(0, pm.index) + " " + text.slice(pm.index + pm[0].length);
  }
  const rangeRe = new RegExp(`\\b(?:das|de|do|entre) ${TIME} (?:as|a|ate|e) ${TIME}`);
  const m = rangeRe.exec(rest) ?? new RegExp(`\\b${TIME} ?(?:-|a|as) ?${TIME}\\b`).exec(rest);
  if (!m) return { start: null, end: null, pause };
  const start = hhmm(m[1]!, m[2], m[3], false);
  // "das 9 às 7" (sem "da noite"): o fim menor que o início é da tarde.
  let end = hhmm(m[4]!, m[5], m[6], false);
  if (start && end && end <= start && m[6] === undefined) end = hhmm(m[4]!, m[5], undefined, true);
  if (!start || !end || end <= start) return { start: null, end: null, pause };
  return { start, end, pause };
}

function findServices(t: string): string[] {
  const out: string[] = [];
  for (const s of SERVICES) if (s.re.test(t) && !out.includes(s.name)) out.push(s.name);
  return out.slice(0, 20);
}

/** Lê a frase e devolve o rascunho. Nunca lança: frase vazia devolve tudo nulo e `unknown` completo. */
export function describeBusiness(sentence: string): SetupDescribeDraft {
  const t = normalize(sentence ?? "");
  const profession = findProfession(t);
  const weekdays = findWeekdays(t);
  const hours = findHours(t);
  const unknown: SetupDescribeDraft["unknown"] = [];
  if (!profession) unknown.push("profession");
  if (weekdays.length === 0) unknown.push("weekdays");
  if (!hours.start || !hours.end) unknown.push("hours");
  return {
    profession,
    team_size: findTeamSize(t),
    weekdays,
    start: hours.start,
    end: hours.end,
    pause: hours.pause,
    services: findServices(t),
    unknown,
  };
}

/** Expediente semanal a partir do rascunho: um bloco por dia, dividido na pausa quando houver. */
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
