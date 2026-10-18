// Importação CSV mínima: parse no navegador, preview e decisão por linha. O servidor revalida tudo.
import { IMPORT_MAX_ROWS, type RejectReason } from "@contracts";
import { fold, normalizePhoneBR, sourceFromText } from "./format.ts";

export const CSV_MAX_BYTES = 1024 * 1024;

/** RFC 4180 com separador detectado (`,` ou `;` do Excel brasileiro), aspas e CRLF. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const outside = firstLine.replace(/"[^"]*"/g, "");
  const sep = (outside.match(/;/g)?.length ?? 0) > (outside.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === sep) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

const HEADERS: Record<"name" | "phone" | "email" | "source", RegExp> = {
  name: /^(nome|nome completo|name|cliente|aluno)$/,
  phone: /^(telefone|celular|whatsapp|fone|tel|phone|contato)$/,
  email: /^(e-?mail|mail)$/,
  source: /^(origem|source|como conheceu|canal|indicacao)$/,
};

export interface PreviewRow {
  /** Linha no arquivo (cabeçalho = 1). */
  line: number;
  name: string;
  /** E.164 quando normalizado; texto original quando inválido (o servidor rejeita e relata). */
  phone: string | null;
  email: string | null;
  declared_source: string | null;
  /** Problema visto já no navegador (o servidor confirma). */
  problem?: { field: string; reason: RejectReason };
}

export type CsvResult = { ok: true; rows: PreviewRow[]; ignoredColumns: string[] } | { ok: false; error: string };

export function readCustomerCsv(text: string): CsvResult {
  if (new TextEncoder().encode(text).byteLength > CSV_MAX_BYTES) return { ok: false, error: "Arquivo maior que 1 MB." };
  const table = parseCsv(text);
  const header = (table[0] ?? []).map((h) => fold(h));
  const col = Object.fromEntries(
    (Object.keys(HEADERS) as (keyof typeof HEADERS)[]).map((k) => [k, header.findIndex((h) => HEADERS[k].test(h))]),
  ) as Record<keyof typeof HEADERS, number>;
  if (col.name < 0) return { ok: false, error: "A primeira linha precisa ter uma coluna “nome”." };
  const used = new Set(Object.values(col).filter((i) => i >= 0));
  const ignoredColumns = (table[0] ?? []).filter((h, i) => !used.has(i) && h.trim() !== "");

  const rows: PreviewRow[] = [];
  const seenPhone = new Map<string, number>();
  const seenEmail = new Map<string, number>();
  for (let i = 1; i < table.length; i++) {
    const cells = table[i] ?? [];
    if (cells.every((c) => c.trim() === "")) continue; // linha vazia não é dado
    const at = (k: keyof typeof HEADERS) => (col[k] >= 0 ? (cells[col[k]] ?? "").trim() : "");
    const phoneRaw = at("phone");
    const phone = normalizePhoneBR(phoneRaw);
    const email = at("email") ? at("email").toLowerCase() : null;
    const row: PreviewRow = {
      line: i + 1,
      name: at("name").replace(/\s+/g, " "),
      phone: "value" in phone ? phone.value : phoneRaw,
      email,
      declared_source: sourceFromText(at("source")),
    };
    if (!row.name) row.problem = { field: "name", reason: "NAME_REQUIRED" };
    else if (row.name.length > 120) row.problem = { field: "name", reason: "NAME_TOO_LONG" };
    else if ("error" in phone) row.problem = { field: "phone", reason: "PHONE_INVALID" };
    else if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) row.problem = { field: "email", reason: "EMAIL_INVALID" };
    else if (row.phone && seenPhone.has(row.phone)) row.problem = { field: "phone", reason: "DUPLICATE_IN_FILE" };
    else if (email && seenEmail.has(email)) row.problem = { field: "email", reason: "DUPLICATE_IN_FILE" };
    if (!row.problem) {
      if (row.phone) seenPhone.set(row.phone, row.line);
      if (email) seenEmail.set(email, row.line);
    }
    rows.push(row);
  }
  if (rows.length === 0) return { ok: false, error: "Nenhuma linha de cliente encontrada." };
  if (rows.length > IMPORT_MAX_ROWS) {
    return { ok: false, error: `Até ${IMPORT_MAX_ROWS} clientes por importação. Divida o arquivo.` };
  }
  return { ok: true, rows, ignoredColumns };
}
