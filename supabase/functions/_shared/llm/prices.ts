// Tabela de preços por modelo, versionada no repositório (P46). Só para ESTIMAR o custo no registro de cada chamada;
// a cobrança real é a do provedor. Mudou o preço ou entrou um modelo: novo `PRICE_TABLE_VERSION` e PR.
//
// Fonte dos preços Anthropic: tabela pública de modelos (US$ por milhão de tokens, prompts até 100 mil tokens).
// OpenAI e Gemini ficam de fora de propósito: o modelo deles vem do segredo `LLM_MODEL` e não há escolha feita.
// Quando o Felipe escolher um, acrescentar a linha aqui com a fonte e a data. Modelo fora da tabela registra
// `cost_usd: null` (sem preço conhecido), nunca zero.

export const PRICE_TABLE_VERSION = "2026-11-03";

export interface ModelPrice {
  /** US$ por milhão de tokens de entrada. */
  input_per_mtok: number;
  /** US$ por milhão de tokens de saída (inclui raciocínio, que é cobrado como saída). */
  output_per_mtok: number;
}

export const PRICES: Readonly<Record<string, ModelPrice>> = {
  // Anthropic (padrão sugerido: claude-haiku-5-5).
  "claude-haiku-5-5": { input_per_mtok: 0.10, output_per_mtok: 0.50 },
  "claude-sonnet-5-5": { input_per_mtok: 2.00, output_per_mtok: 10.00 },
  "claude-opus-5-5": { input_per_mtok: 4.00, output_per_mtok: 20.00 },
};

/** Custo estimado em US$ (6 casas). null = modelo sem preço na tabela. */
export function estimateCostUsd(model: string | null, inputTokens: number, outputTokens: number): number | null {
  const p = model ? PRICES[model] : undefined;
  if (!p) return null;
  const usd = (inputTokens * p.input_per_mtok + outputTokens * p.output_per_mtok) / 1_000_000;
  return Math.round(usd * 1_000_000) / 1_000_000;
}
