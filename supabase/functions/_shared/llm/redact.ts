// O que nunca vai para o modelo: telefone, e-mail, CPF, CNPJ, CEP, endereço e outros números longos de documento.
// `redactPii` roda dentro de `extract` em TODA chamada, então nenhum chamador consegue mandar esses dados por engano.
// `labelNames` troca nomes de clientes conhecidos por rótulos ("cliente 1") quando a tarefa permite, e devolve o mapa
// para restaurar o nome na resposta, só no servidor.

const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/gu;
/** CPF (000.000.000-00) e CNPJ (00.000.000/0000-00), com ou sem pontuação. */
const CPF = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g;
const CNPJ = /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g;
/**
 * CEP (T12): 01310-100, 01310100 ou 01.310-100. Antes do telefone, senão os 8 dígitos viram "[telefone]".
 * Não casa logo depois de DDD ("(11) 32654321", "11 32654321"): aí é telefone fixo e o PHONE trata.
 * O prefixo de zona sozinho ("01310", usado no Domicílio) tem 5 dígitos e fica.
 */
const CEP = /(?<![\p{N}.\-/])(?<![\p{N})][\s.\-]?)\d{2}\.?\d{3}-?\d{3}(?![\p{N}]|[.\-/][\p{N}])/gu;
/** Telefone BR: +55, DDD com ou sem parênteses, 8 ou 9 dígitos, separadores comuns. */
const PHONE = /(?:\+?55[\s.-]?)?(?:\(?\d{2}\)?[\s.-]?)?9?\d{4}[\s.-]?\d{4}\b/g;
/** Qualquer sequência longa de dígitos que sobrou (RG, cartão, conta): 9 ou mais dígitos, com separadores.
 * Datas (05/11/2026, 2026-11-05) têm no máximo 8 dígitos e ficam: o pedido precisa delas. */
const LONG_DIGITS = /\d(?:[\s.\-/]?\d){8,}/g;

// Endereço (T12): tipo de logradouro + nome + número opcional ("123", "nº 45", "s/n", "km 20") + complemento curto
// ("ap 12", "bloco B"). Bairro sem logradouro ("Moema", "Vila Mariana") fica: sozinho não localiza ninguém.
// Duas formas: (a) com número, o nome pode ter várias palavras em qualquer caixa ("rua oscar freire 100");
// (b) sem número, depois da primeira palavra só seguem palavras com maiúscula ("Rua das Flores", "rua augusta").
// Sem número, Praça, Estrada, Rodovia, Largo e abreviações menos comuns só contam com maiúscula
// ("a estrada estava ruim" e "cabelo largo" ficam).
const STREET_ANY_CASE = String.raw`(?:[Rr]ua|RUA|R\.|[Aa]venida|AVENIDA|[Aa]v\.?|AV\.?|[Aa]lameda|[Aa]l\.|[Tt]ravessa)`;
const STREET_CAPITAL = String.raw`(?:Trav\.|Tv\.|Pra[çc]a|PRA[ÇC]A|P[çc]a\.|Estrada|ESTRADA|Estr\.|Rodovia|RODOVIA|Rod\.|Largo|LARGO)`;
/** Com número da casa, todos os tipos valem em qualquer caixa ("praça da república, 10"). */
const STREET_NUMBERED = String.raw`(?:${STREET_ANY_CASE}|${STREET_CAPITAL}|tv\.|trav\.|pra[çc]a|estrada|rodovia|largo)`;
/** Palavras que encerram o nome do logradouro (tempo, preposição solta, verbo comum do pedido). */
const NAME_STOP = String.raw`(?:às|as|a|o|os|ao|aos|à|no|na|nos|nas|em|um|uma|pra|pro|para|com|sem|que|perto|hoje|amanhã|amanha|` +
  String.raw`ontem|depois|antes|até|ate|entre|dia|semana|mês|mes|cedo|tarde|noite|manhã|manha|meio|desde|porque|mas|ou|e|é|` +
  String.raw`era|está|esta|estava|tá|ta|tem|vai|foi|fica|ficou|lá|la|aqui|ali|ok|km)`;
const CONNECTOR = String.raw`(?:d[aeo]s?|del)`;
const END = String.raw`(?![\p{L}\p{N}$/])`;
/** Uma palavra do nome: letras (com acento), apóstrofo, hífen, ponto de abreviação; não é palavra de parada. */
const WORD_BODY = String.raw`[\p{L}'’\-]*(?:\.(?=\s+\p{L}))?${END}`;
const NOT_STOP = String.raw`(?!(?:${NAME_STOP}|${CONNECTOR})(?![\p{L}\p{N}]))`;
const NAME_WORD = String.raw`${NOT_STOP}\p{L}${WORD_BODY}`;
const NAME_WORD_CAPITAL = String.raw`${NOT_STOP}\p{Lu}${WORD_BODY}`;
const NEXT = (w: string) => String.raw`(?:\s+(?:${CONNECTOR}\s+)?${w})`;
/** Número da casa: até 5 dígitos que não são horário (10h, 14:30), duração (30 min), valor (60,00) nem percentual. */
const HOUSE_NUMBER = String.raw`(?:(?:n[º°]\.?|n\.|núm(?:ero)?\.?|numero|km)\s*)?` +
  String.raw`(?:\d{1,5}(?!\p{N}|[:hH%]|[.,]\p{N}|\s*(?:h|hs|hrs?|min|minutos?|horas?|reais|%)(?![\p{L}]))|s\/n(?![\p{L}]))`;
const COMPLEMENT = String.raw`(?:\s*,?\s*(?:ap(?:to|artamento)?\.?|apt\.?|bloco|bl\.?|casa|sala|conj(?:unto)?\.?|cj\.?|lote|lt\.?|andar|fundos)` +
  String.raw`(?![\p{L}])(?:\s*\d{1,4}[A-Za-z]?(?![\p{L}\p{N}:])|\s+[A-Za-z](?![\p{L}\p{N}]))?){0,2}`;
const FIRST = (w: string) => String.raw`\s+(?:${CONNECTOR}\s+)?${w}`;
const ADDRESS = new RegExp(
  String.raw`(?<![\p{L}\p{N}])(?:` +
    // (a) com número da casa
    String.raw`${STREET_NUMBERED}${FIRST(NAME_WORD)}${NEXT(NAME_WORD)}{0,5}\s*,?\s*${HOUSE_NUMBER}` +
    // (b) sem número: nome curto, o resto com maiúscula
    String.raw`|(?:${STREET_ANY_CASE}${FIRST(NAME_WORD)}|${STREET_CAPITAL}${FIRST(NAME_WORD_CAPITAL)})${NEXT(NAME_WORD_CAPITAL)}{0,5}` +
    String.raw`)${COMPLEMENT}`,
  "gu",
);

export function redactPii(text: string): string {
  return text
    .replace(EMAIL, "[e-mail]")
    .replace(CNPJ, "[documento]")
    .replace(CPF, "[documento]")
    .replace(CEP, "[cep]")
    .replace(ADDRESS, "[endereço]")
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
