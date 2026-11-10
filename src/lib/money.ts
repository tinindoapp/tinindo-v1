// Dinheiro do app inteiro: centavos inteiros, nunca float (ADR-0004). Um único leitor e um único formatador, para que o
// mesmo texto digitado vire a mesma quantia em qualquer tela (Caixa, Contas, Materiais, Configuração…).
const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/** Centavos → "R$ 1.234,56". Sem valor → "—". */
export function formatCents(cents: number | null | undefined): string {
  return cents === null || cents === undefined ? "—" : BRL.format(cents / 100);
}

/** Centavos → texto para o campo de valor ("1234,56"), que parseBRL lê de volta. */
export function centsToInput(cents: number): string {
  return `${Math.trunc(cents / 100)},${String(cents % 100).padStart(2, "0")}`;
}

/**
 * Texto em reais → centavos inteiros.
 * "60" | "60,5" | "1.234,56" | "R$ 60,00" → centavos. Com vírgula, o ponto é separador de milhar; sem vírgula, o ponto
 * é o decimal ("10.50" = R$ 10,50). Vazio → null; inválido (letras, negativo, três casas) → undefined.
 * Cada tela decide o que null e undefined significam na validação do formulário dela.
 */
export function parseBRL(raw: string): number | null | undefined {
  const text = raw.replace(/R\$|\s/g, "");
  if (!text) return null;
  const normalized = text.includes(",") ? text.replace(/\./g, "").replace(",", ".") : text;
  const m = /^(\d{1,13})(?:\.(\d{1,2}))?$/.exec(normalized);
  if (!m) return undefined;
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
}
