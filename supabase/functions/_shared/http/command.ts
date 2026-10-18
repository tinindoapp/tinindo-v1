// Utilitários de comando das Edge Functions: hash canônico da entrada (idempotência) e cursor opaco.
// TypeScript puro (Web APIs): roda em Deno e Node 22.
import { isUuid } from "./respond.ts";

/** JSON com chaves ordenadas: o mesmo conteúdo gera sempre o mesmo hash. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Cursor opaco = base64url de {key, id}. Não é segredo: só posição na ordenação do próprio tenant. */
export function encodeCursor(next: { key: string; id: string }): string {
  const bytes = new TextEncoder().encode(JSON.stringify({ k: next.key, i: next.id }));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

/** undefined = sem cursor; false = cursor inválido. */
export function decodeCursor(raw: string | undefined): { key: string; id: string } | undefined | false {
  if (raw === undefined) return undefined;
  try {
    const bin = atob(raw.replaceAll("-", "+").replaceAll("_", "/"));
    const json: unknown = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
    const { k, i } = (json ?? {}) as { k?: unknown; i?: unknown };
    if (typeof k !== "string" || k.length > 200 || typeof i !== "string" || !isUuid(i)) return false;
    return { key: k, id: i };
  } catch {
    return false;
  }
}
