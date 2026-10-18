// Leitura determinística do pedido em pt-BR: datas, períodos, horários, valores e nomes.
// O texto do usuário e os dados do negócio são DADOS: nada aqui executa ou obedece ao conteúdo.
import { addDays, localParts, MONTHS, weekdayOf, zoned } from "./time.ts";
import type { Window } from "./time.ts";

/** minúsculas, sem acento, espaços simples. */
export function norm(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Nome vindo do banco/CSV exibido como texto: sem comentário/tag HTML, sem quebra, no máximo 60 caracteres. */
export function displayName(raw: string): string {
  const clean = raw
    .replace(/<!--[\s\S]*?(-->|$)/g, " ")
    .replace(/<[^>]*>?/g, " ")
    .split("").map((ch) => (ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127 ? " " : ch)).join("")
    .replace(/\s+/g, " ")
    .trim();
  return clean.length > 60 ? `${clean.slice(0, 59).trimEnd()}…` : clean || "(sem nome)";
}

const WEEKDAY_WORDS: [RegExp, number][] = [
  [/\bdomingo\b/, 0],
  [/\bsegunda(-feira)?\b/, 1],
  [/\bterca(-feira)?\b/, 2],
  [/\bquarta(-feira)?\b/, 3],
  [/\bquinta(-feira)?\b/, 4],
  [/\bsexta(-feira)?\b/, 5],
  [/\bsabado\b/, 6],
];

/** Primeiro dia da semana citado (0 = domingo). */
export function weekdayIn(n: string): number | null {
  let best: { at: number; wd: number } | null = null;
  for (const [re, wd] of WEEKDAY_WORDS) {
    const m = re.exec(n);
    if (m && (!best || m.index < best.at)) best = { at: m.index, wd };
  }
  return best?.wd ?? null;
}

/** Data citada (hoje, amanhã, dia da semana, dd/mm). null = nenhuma. */
export function dayIn(n: string, today: string): string | null {
  if (/\bdepois de amanha\b/.test(n)) return addDays(today, 2);
  if (/\bamanha\b/.test(n)) return addDays(today, 1);
  if (/\bhoje\b/.test(n)) return today;
  const dm = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/.exec(n);
  if (dm) {
    const y = dm[3] ? (dm[3].length === 2 ? 2000 + Number(dm[3]) : Number(dm[3])) : Number(today.slice(0, 4));
    const mo = Number(dm[2]);
    const d = Number(dm[1]);
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  const wd = weekdayIn(n);
  if (wd !== null) {
    const diff = (wd - weekdayOf(today) + 7) % 7;
    return addDays(today, diff);
  }
  return null;
}

export interface Period {
  window: Window;
  /** Datas locais [início, fim] inclusivas, para o texto. */
  first: string;
  last: string;
  label: string;
  days: number;
}

function periodOf(first: string, lastExclusive: string, tz: string, label: string): Period {
  const days = Math.round((Date.parse(lastExclusive) - Date.parse(first)) / 86_400_000);
  return {
    window: { starts_at: zoned(first, "00:00", tz).toISOString(), ends_at: zoned(lastExclusive, "00:00", tz).toISOString() },
    first,
    last: addDays(lastExclusive, -1),
    label,
    days,
  };
}

/** Período citado (semana passada, esse mês, setembro, esse ano, últimos N dias, um dia). */
export function periodIn(n: string, now: Date, tz: string): Period | null {
  const today = localParts(now, tz).date;
  const tomorrow = addDays(today, 1);
  const monday = addDays(today, -((weekdayOf(today) + 6) % 7));
  const [y, m] = today.split("-").map(Number) as [number, number];
  const monthStart = (yy: number, mm: number) => `${yy}-${String(mm).padStart(2, "0")}-01`;
  const nextMonth = (yy: number, mm: number) => (mm === 12 ? monthStart(yy + 1, 1) : monthStart(yy, mm + 1));

  const last = /\bultimos (\d{1,4}) dias\b/.exec(n);
  if (last) {
    const k = Number(last[1]);
    return periodOf(addDays(tomorrow, -k), tomorrow, tz, `últimos ${k} dias`);
  }
  if (/\bsemana passada\b|\bultima semana\b/.test(n)) return periodOf(addDays(monday, -7), monday, tz, "semana passada");
  if (/\b(essa|esta|nessa|nesta) semana\b|\bda semana\b/.test(n)) return periodOf(monday, addDays(monday, 7), tz, "esta semana");
  if (/\bmes passado\b|\bultimo mes\b/.test(n)) {
    const [py, pm] = m === 1 ? [y - 1, 12] : [y, m - 1];
    return periodOf(monthStart(py, pm), monthStart(y, m), tz, MONTHS[pm - 1] ?? "mês passado");
  }
  if (/\b(esse|este|nesse|neste) mes\b|\bdo mes\b|\bno mes\b/.test(n)) return periodOf(monthStart(y, m), tomorrow, tz, "este mês");
  if (/\b(esse|este|nesse|neste) ano\b|\bdo ano\b|\bno ano\b/.test(n)) return periodOf(`${y}-01-01`, tomorrow, tz, `${y}`);
  for (let i = 0; i < 12; i += 1) {
    if (new RegExp(`\\b${norm(MONTHS[i] ?? "")}\\b`).test(n)) {
      const mm = i + 1;
      const yy = mm > m ? y - 1 : y;
      const end = mm === m ? tomorrow : nextMonth(yy, mm);
      return periodOf(monthStart(yy, mm), end, tz, MONTHS[i] ?? "");
    }
  }
  const day = dayIn(n, today);
  if (day) return periodOf(day, addDays(day, 1), tz, "dia");
  return null;
}

/** Horários citados, em ordem ("10h", "10:30", "às 15", "15h40"). */
export function timesIn(n: string): string[] {
  const out: string[] = [];
  const re = /\b(?:as |das |do |o das |para as |pras |pra )?(\d{1,2})(?:(?::|h)(\d{2})|h|\s?horas?)\b|\bas (\d{1,2})\b/g;
  for (const m of n.matchAll(re)) {
    const h = Number(m[1] ?? m[3]);
    const min = Number(m[2] ?? 0);
    if (h <= 23 && min <= 59) out.push(`${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`);
  }
  return out;
}

export type DayPart = "manha" | "tarde" | "noite" | null;
export function dayPartIn(n: string): DayPart {
  if (/\b(de|pela|na) manha\b/.test(n)) return "manha";
  if (/\b(a|de|pela|na) tarde\b/.test(n)) return "tarde";
  if (/\b(a|de|pela|na) noite\b/.test(n)) return "noite";
  return null;
}

export const DAY_PART_RANGE: Record<Exclude<DayPart, null>, [string, string]> = {
  manha: ["00:00", "12:00"],
  tarde: ["12:00", "24:00"],
  noite: ["18:00", "24:00"],
};

/** Percentual citado ("50%", "15 por cento") em basis points. */
export function percentIn(n: string): number | null {
  const m = /\b(\d{1,3})(?:[.,](\d{1,2}))?\s?(?:%|por cento)/.exec(n);
  if (!m) return null;
  const bps = Number(m[1]) * 100 + Number((m[2] ?? "0").padEnd(2, "0"));
  return bps > 0 && bps <= 10_000 ? bps : null;
}

const NAME_STOPWORDS = new Set([
  "cliente", "clientes", "exemplo", "para", "pra", "com", "sem", "login", "dona", "seu", "sua", "senhor", "senhora",
  "corte", "barba", "hoje", "amanha", "agenda", "horario",
]);

export interface NameMatch<T> {
  exact: T[];
  partial: T[];
}

/** Clientes citados: nome completo (sem parênteses) no texto = exato; senão, um termo distintivo do nome. */
export function matchNames<T extends { name: string }>(n: string, items: T[]): NameMatch<T> {
  const exact: T[] = [];
  const partial: T[] = [];
  const words = new Set(n.split(/[^a-z0-9]+/).filter(Boolean));
  for (const it of items) {
    const full = norm(displayName(it.name).replace(/\([^)]*\)/g, "")).replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
    if (full.length >= 3 && ` ${n.replace(/[^a-z0-9 ]+/g, " ")} `.includes(` ${full} `)) {
      exact.push(it);
      continue;
    }
    const tokens = full.split(" ").filter((t) => t.length >= 3 && !NAME_STOPWORDS.has(t));
    if (tokens.length > 0 && words.has(tokens[0] ?? "")) partial.push(it);
  }
  // Nome completo mais longo vence (ex.: "Maria Exemplo Silva" e não só "Maria").
  return { exact, partial: exact.length ? [] : partial };
}

/** Serviços citados pelo nome (palavra inteira, sem acento). */
export function servicesIn<T extends { name: string }>(n: string, services: T[]): T[] {
  return services.filter((s) => {
    const key = norm(s.name);
    return new RegExp(`\\b${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}s?\\b`).test(n);
  });
}
