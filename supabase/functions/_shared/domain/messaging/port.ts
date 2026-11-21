// Porta do provedor de mensagens (P12; WhatsApp oficial no bloco 2 das integrações reais). Tipos e assinatura comuns
// aos adaptadores: `simulated` (providers.ts) e `whatsapp_cloud` (_shared/providers/meta.ts).
// Nenhum adaptador reenvia por conta própria: 'delivery_unknown' só sai por consulta de status ou webhook; 'retry'
// volta para a FILA do banco (espera crescente e teto de tentativas em app.ch_dispatch_rules).

/** O que o provedor real precisa para mandar um modelo (channel_dispatch_claim → app.ch_provider_template). */
export interface ProviderTemplate {
  /** Nome do modelo cadastrado no provedor. */
  name: string;
  /** Idioma do modelo (pt_BR). */
  language: string;
  category: "utility" | "marketing" | "authentication";
  /** Parâmetros na ordem do provedor: {{1}} = nome do negócio nos modelos ao cliente. */
  params: string[];
}

export interface OutboundItem {
  ref: string;
  provider: "simulated" | "whatsapp_cloud";
  external_account_id: string;
  to: string;
  body: string;
  kind: "text" | "template";
  template_code: string | null;
  template_params: string[] | null;
  /** NULL no simulado (usa `body`). No provedor real, obrigatório para modelo. */
  provider_template?: ProviderTemplate | null;
}

/** Alcance de um limite do provedor: o número do negócio, o par número→cliente, ou a conta inteira. */
export type LimitScope = "number" | "pair" | "account";

export type SendResult =
  | { outcome: "sent"; provider_message_id: string }
  | { outcome: "failed"; reason: string }
  | { outcome: "delivery_unknown" }
  /** Limite do provedor: NADA saiu. Volta à fila do banco com espera crescente. */
  | { outcome: "retry"; reason: string; scope: LimitScope; retry_after_s?: number };

/** Leitura do número no provedor (só o que o provedor informa; nada inventado). */
export type LookupResult =
  | { outcome: "found"; display_phone_number: string; verified_name: string | null; quality_rating: string | null }
  /** O provedor recusou (4xx): o id não existe ou o token não alcança este número. */
  | { outcome: "not_found"; reason: string }
  /** Sem resposta confiável (5xx, tempo esgotado, rede). */
  | { outcome: "unavailable" };

/** Evento já normalizado para public.channel_webhook_ingest. */
export interface NormalizedEvent {
  external_event_id: string;
  kind: "inbound" | "status";
  external_account_id: string;
  phone_e164?: string;
  text?: string;
  profile_name?: string;
  provider_message_id?: string;
  status?: "sent" | "delivered" | "read" | "failed";
  reason?: string;
}

export interface Provider {
  readonly name: "simulated" | "whatsapp_cloud";
  readonly configured: boolean;
  send(item: OutboundItem): Promise<SendResult>;
  /** Consulta de status para resultado desconhecido. null = o provedor não informa (fica desconhecido). */
  status(providerMessageId: string | null, ref: string): Promise<"sent" | "failed" | null>;
  /** Assinatura do webhook sobre o corpo BRUTO (bytes, como chegaram). */
  verifySignature(rawBody: Uint8Array | string, header: string | null): Promise<boolean>;
  /** Corpo do webhook → eventos normalizados. Formato inesperado = lista vazia (nunca lança). */
  normalize(body: unknown): NormalizedEvent[];
  /** Leitura do número no provedor (só o real tem). */
  lookup?(externalAccountId: string): Promise<LookupResult>;
}

const enc = new TextEncoder();
const hex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
const bytes = (v: Uint8Array | string): Uint8Array<ArrayBuffer> => (typeof v === "string" ? enc.encode(v) : new Uint8Array(v));

export async function hmacSha256Hex(secret: string, data: Uint8Array | string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, bytes(data)));
}

/** Comparação em tempo constante. */
export function sameHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** `X-Hub-Signature-256: sha256=<hex>` = HMAC-SHA256 do segredo sobre o corpo bruto. Sem header ou fora do formato: falso. */
export async function verifyHubSignature(secret: string, rawBody: Uint8Array | string, header: string | null): Promise<boolean> {
  if (!secret || !header?.startsWith("sha256=")) return false;
  const given = header.slice(7).trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(given)) return false;
  return sameHex(given, await hmacSha256Hex(secret, rawBody));
}
