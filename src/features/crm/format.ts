// Formatação e normalização de entrada do módulo CRM. Funções puras, testadas em format.test.ts.
import type { DeclaredSource, RejectReason } from "@contracts";

// Telefone: o analisador e o formatador comuns moram em src/lib/phone.ts (Clientes, Agenda e link público usam o mesmo).
export { formatPhone, normalizePhoneBR, telHref, whatsappHref } from "../../lib/phone.ts";

// Dinheiro: o leitor e o formatador comuns moram em src/lib/money.ts.
export { formatCents, parseBRL } from "../../lib/money.ts";

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
