// Apresentação dos indicadores: nunca mostrar "0%" quando o dado é insuficiente ou não existe.
import type { Metric } from "@contracts";

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const INT = new Intl.NumberFormat("pt-BR");
const PCT = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 1 });
export const formatCents = (c: number) => BRL.format(c / 100);

export function metricValue(m: Pick<Metric, "unit" | "value" | "status">): string {
  if (m.status === "unavailable") return "Ainda não medido";
  if (m.value === null) return "Dados insuficientes";
  if (m.unit === "ratio") return PCT.format(m.value);
  if (m.unit === "cents") return formatCents(m.value);
  return `${INT.format(m.value)} min`;
}

/** A conta por trás do número (numerador e denominador). */
export function metricMath(m: Metric): string | null {
  if (m.unit !== "ratio" || m.status === "unavailable") return null;
  const unit = m.key === "occupancy" ? " min" : "";
  return `${INT.format(m.numerator ?? 0)}${unit} de ${INT.format(m.denominator ?? 0)}${unit}`;
}

/** Diferença para a baseline: pontos percentuais em taxas, valor absoluto no resto. */
export function deltaText(unit: Metric["unit"], delta: number | null): string {
  if (delta === null) return "sem comparação";
  const sign = delta > 0 ? "+" : delta < 0 ? "−" : "";
  const abs = Math.abs(delta);
  if (unit === "ratio") return `${sign}${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(abs * 100)} p.p.`;
  if (unit === "cents") return `${sign}${formatCents(abs)}`;
  return `${sign}${INT.format(abs)} min`;
}

/** Quando subir é bom (`up`) ou ruim (`down`), por indicador. Sem direção (minutos internos): só a diferença. */
export const BETTER_WHEN: Partial<Record<Metric["key"] | "leftover", "up" | "down">> = {
  occupancy: "up", no_show: "down", cancellation: "down", waitlist_acceptance: "up", quote_acceptance: "up",
  received: "up", expenses: "down", charge_coverage: "up", reminders: "up", leftover: "up",
};

export interface Trend {
  /** Seta só visual: ▲ subiu, ▼ caiu, = igual. */
  arrow: "▲" | "▼" | "=";
  /** Palavra para leitor de tela no lugar da seta. */
  spoken: "subiu" | "caiu" | "ficou igual";
  /** Diferença sem sinal: "1,2 p.p.", "R$ 60,00", "15 min". */
  amount: string;
  /** Se a mudança é boa para o negócio, sabendo a direção do indicador. */
  verdict: "melhorou" | "piorou" | "sem mudança" | null;
}

/** Diferença com seta e palavra (item 54): "▼ 1,2 p.p. · melhorou" para faltas que caíram. */
export function trend(key: Metric["key"] | "leftover", unit: Metric["unit"], delta: number | null): Trend | null {
  if (delta === null) return null;
  const amount = deltaText(unit, Math.abs(delta)).replace(/^\+/, "");
  if (delta === 0) return { arrow: "=", spoken: "ficou igual", amount, verdict: "sem mudança" };
  const up = delta > 0;
  const better = BETTER_WHEN[key];
  return {
    arrow: up ? "▲" : "▼",
    spoken: up ? "subiu" : "caiu",
    amount,
    verdict: better ? ((better === "up") === up ? "melhorou" : "piorou") : null,
  };
}

/** Mesma frase em texto corrido (testes e Toast): "▼ 1,2 p.p. · melhorou". */
export const trendText = (t: Trend | null) => (t ? `${t.arrow} ${t.amount}${t.verdict ? ` · ${t.verdict}` : ""}` : "sem comparação");

/** Espelha app.an_metric: razão com 4 casas; denominador zero = insuficiente. */
export function ratioMetric(num: number, den: number): Pick<Metric, "numerator" | "denominator" | "value" | "status"> {
  return { numerator: num, denominator: den, value: den === 0 ? null : Math.round((num / den) * 10_000) / 10_000, status: den === 0 ? "insufficient" : "ok" };
}

/** Dias civis no fuso do negócio: [início do dia de (hoje − dias), início de hoje + extra). */
export function localDayStart(now: Date, offsetDays: number, timeZone: string): string {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date(now.getTime() + offsetDays * 86_400_000));
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const guess = new Date(Date.UTC(y, m - 1, d));
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit" }).formatToParts(guess);
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const offset = Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute")) - guess.getTime();
  return new Date(guess.getTime() - offset).toISOString();
}

export const PERIODS = [
  { id: "7", label: "Últimos 7 dias (até ontem)", from: -7, to: 0 },
  { id: "28", label: "Últimos 28 dias (até ontem)", from: -28, to: 0 },
  // Mesmo período das Metas: do dia 1º do mês até ontem (from é calculado no dia, ver monthStartOffset).
  { id: "month", label: "Este mês (até ontem)", from: null, to: 0 },
  { id: "next7", label: "Hoje e próximos 6 dias", from: 0, to: 7 },
] as const;

/** Dias entre hoje e o dia 1º do mês corrente, no fuso do negócio (0 no próprio dia 1º). */
export function monthStartOffset(now: Date, timeZone: string): number {
  const day = Number(new Intl.DateTimeFormat("en-CA", { timeZone, day: "2-digit" }).format(now));
  return -(day - 1);
}
