// O que nunca vai para o modelo: telefone, e-mail, CPF, CNPJ e outros números longos de documento.
// `redactPii` roda dentro de `extract` em TODA chamada, então nenhum chamador consegue mandar esses dados por engano.
// `labelNames` troca nomes de clientes conhecidos por rótulos ("cliente 1") quando a tarefa permite, e devolve o mapa
// para restaurar o nome na resposta, só no servidor.

const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/gu;
/** CPF (000.000.000-00) e CNPJ (00.000.000/0000-00), com ou sem pontuação. */
const CPF = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g;
const CNPJ = /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g;
/** Telefone BR: +55, DDD com ou sem parênteses, 8 ou 9 dígitos, separadores comuns. */
const PHONE = /(?:\+?55[\s.-]?)?(?:\(?\d{2}\)?[\s.-]?)?9?\d{4}[\s.-]?\d{4}\b/g;
/** Qualquer sequência longa de dígitos que sobrou (RG, cartão, conta): 9 ou mais dígitos, com separadores.
 * Datas (05/11/2026, 2026-11-05) têm no máximo 8 dígitos e ficam: o pedido precisa delas. */
const LONG_DIGITS = /\d(?:[\s.\-/]?\d){8,}/g;

export function redactPii(text: string): string {
  return text
    .replace(EMAIL, "[e-mail]")
    .replace(CNPJ, "[documento]")
    .replace(CPF, "[documento]")
    .replace(PHONE, (m) => (m.replace(/\D/g, "").length >= 8 ? "[telefone]" : m))
    .replace(LONG_DIGITS, "[número]");
}

/** Tem algo que `redactPii` trocaria? Usado nos testes de vazamento. */
export function hasPii(text: string): boolean {
  return redactPii(text) !== text;
}

const fold = (s: string) => s.normalize("NFC").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const STOP = new Set(["cliente", "clientes", "para", "pra", "com", "sem", "dona", "seu", "sua", "senhor", "senhora", "exemplo"]);

export interface Labeled {
  text: string;
  /** rótulo → trecho original do texto (para restaurar). */
  labels: Map<string, string>;
}

/**
 * Troca no texto os nomes de clientes conhecidos (nome completo ou primeiro nome distintivo, palavra inteira, sem
 * diferença de acento ou caixa) por "cliente N". O mesmo trecho recebe o mesmo rótulo. Nomes desconhecidos ficam:
 * o servidor não adivinha quem é quem; a correspondência com o cadastro continua sendo do motor determinístico.
 */
export function labelNames(text: string, names: readonly string[]): Labeled {
  const src = text.normalize("NFC");
  const folded = fold(src);
  // A troca usa as posições do texto dobrado no original: só vale se o comprimento não mudou.
  if (folded.length !== src.length) return { text: src, labels: new Map() };
  const terms = new Set<string>();
  for (const raw of names) {
    const full = fold(raw).replace(/\([^)]*\)/g, " ").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
    if (full.length >= 3) terms.add(full);
    const first = full.split(" ").find((t) => t.length >= 3 && !STOP.has(t));
    if (first) terms.add(first);
  }
  // Mais longos primeiro: "maria exemplo silva" antes de "maria".
  const ordered = [...terms].sort((a, b) => b.length - a.length);
  const spans: [number, number][] = [];
  for (const term of ordered) {
    const re = new RegExp(`(?<![a-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+")}(?![a-z0-9])`, "g");
    for (const m of folded.matchAll(re)) {
      const s = m.index ?? 0;
      const e = s + m[0].length;
      if (!spans.some(([a, b]) => s < b && e > a)) spans.push([s, e]);
    }
  }
  spans.sort((a, b) => a[0] - b[0]);
  const labels = new Map<string, string>();
  const byOriginal = new Map<string, string>();
  let out = "";
  let at = 0;
  for (const [s, e] of spans) {
    const original = src.slice(s, e);
    const key = fold(original).replace(/\s+/g, " ");
    let label = byOriginal.get(key);
    if (!label) {
      label = `cliente ${byOriginal.size + 1}`;
      byOriginal.set(key, label);
      labels.set(label, original);
    }
    out += src.slice(at, s) + label;
    at = e;
  }
  out += src.slice(at);
  return { text: out, labels };
}

/** Restaura os rótulos ("cliente 1") pelo trecho original. Rótulo desconhecido fica como está. */
export function restoreLabels(text: string, labels: ReadonlyMap<string, string>): string {
  if (labels.size === 0) return text;
  return text.replace(/\bcliente (\d{1,3})\b/gi, (m, n: string) => labels.get(`cliente ${n}`) ?? m);
}
