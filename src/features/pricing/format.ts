// Formatação do módulo de Preços. Centavos inteiros e basis points; nunca float para dinheiro.
export { formatCents } from "../../lib/money.ts";
/** 1500 → "15%"; 1250 → "12,5%". */
export const formatBps = (bps: number) => `${(bps / 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;

/** "15" | "12,5" → basis points. Vazio → 0; inválido → undefined. */
export function parsePercent(raw: string): number | undefined {
  const t = raw.trim().replaceAll("%", "").replaceAll(",", ".");
  if (!t) return 0;
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(t)) return undefined;
  // eslint-disable-next-line no-restricted-syntax -- percentual em pontos-base, não é dinheiro
  const bps = Math.round(Number(t) * 100);
  return bps <= 10_000 ? bps : undefined;
}

export const WEEKDAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"] as const;

/** Início do dia seguinte ao dia civil local (fim exclusivo da validade "até este dia"). */
export { formatDate, localDate, startOfNextLocalDay as endOfLocalDayExclusive } from "../../lib/time.ts";
