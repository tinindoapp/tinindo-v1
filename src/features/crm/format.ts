// Formatação e normalização de entrada do módulo CRM. Funções puras, testadas em format.test.ts.
import type { DeclaredSource, RejectReason } from "@contracts";

// Telefone: o analisador e o formatador comuns moram em src/lib/phone.ts (Clientes, Agenda e link público usam o mesmo).
export { formatPhone, normalizePhoneBR, telHref, whatsappHref } from "../../lib/phone.ts";

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/** Centavos inteiros → "R$ 60,00". */
export function formatCents(cents: number | null): string {
  return cents === null ? "—" : BRL.format(cents / 100);
}

/** Centavos → "60,00" para edição. */
export function centsToInput(cents: number | null): string {
  if (cents === null) return "";
  return `${Math.trunc(cents / 100)},${String(cents % 100).padStart(2, "0")}`;
}

/**
 * "60" | "60,5" | "1.234,56" | "R$ 60,00" → centavos inteiros, sem float. Vazio → null.
 * Retorna undefined quando o texto não é um valor válido.
 */
export function parseBRL(raw: string): number | null | undefined {
  const text = raw.replace(/R\$|\s/g, "");
  if (!text) return null;
  const normalized = text.includes(",") ? text.replace(/\./g, "").replace(",", ".") : text;
  const m = /^(\d{1,13})(?:\.(\d{1,2}))?$/.exec(normalized);
  if (!m) return undefined;
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
}

/** Percentual "5" | "2,5" → basis points (500 | 250). Vazio → null; inválido → undefined. */
export function parsePercentToBps(raw: string): number | null | undefined {
  const text = raw.replace(/%|\s/g, "").replace(",", ".");
  if (!text) return null;
  const m = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(text);
  if (!m) return undefined;
  const bps = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  return bps <= 10_000 ? bps : undefined;
}

export const SOURCE_LABEL: Record<DeclaredSource, string> = {
  referral: "Indicação",
  instagram: "Instagram",
  whatsapp: "WhatsApp",
  google: "Google",
  walk_in: "Passou no local",
  condominium: "Condomínio",
  returning: "Já era cliente",
  other: "Outro",
};

export const REJECT_LABEL: Record<RejectReason, string> = {
  NAME_REQUIRED: "Nome em branco",
  NAME_TOO_LONG: "Nome com mais de 120 caracteres",
  PHONE_INVALID: "Telefone inválido",
  EMAIL_INVALID: "E-mail inválido",
  SOURCE_INVALID: "Origem não reconhecida",
  DUPLICATE_IN_FILE: "Repetido no próprio arquivo",
};

/** Texto livre da planilha → origem do contrato. Desconhecido fica como está (o servidor rejeita). */
export function sourceFromText(raw: string | null | undefined): string | null {
  const t = fold(raw ?? "");
  if (!t) return null;
  const table: [RegExp, DeclaredSource][] = [
    [/^(indicacao|indicado|referral)/, "referral"],
    [/^(instagram|insta|ig)$/, "instagram"],
    [/^(whatsapp|zap|wpp|whats)$/, "whatsapp"],
    [/^google/, "google"],
    [/^(passou|porta|rua|balcao|walk.?in)/, "walk_in"],
    [/^(condominio|predio)/, "condominium"],
    [/^(retorno|ja era cliente|antigo|returning)/, "returning"],
    [/^(outro|outros|other)$/, "other"],
  ];
  return table.find(([re]) => re.test(t))?.[1] ?? (raw ?? "").trim();
}

/** Minúsculas sem acento e com espaços simples (cabeçalhos, nomes, origens). */
export function fold(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}
