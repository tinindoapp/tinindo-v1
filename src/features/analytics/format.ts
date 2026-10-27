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
