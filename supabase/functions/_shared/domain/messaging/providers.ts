// Porta do provedor de mensagens (P12). Dois adaptadores:
// * simulated: determinístico, sem rede. "Entrega" ao telefone fictício (channel_sim_phone) e simula falha permanente
//   (número termina em 0000) e resultado desconhecido (termina em 9999; a consulta de status resolve como enviado).
// * whatsapp_cloud: API oficial (Graph). Só com segredos; sem eles, `configured: false` e o despacho responde 503.
// Nenhum adaptador reenvia por conta própria: 'delivery_unknown' só sai por consulta de status ou webhook.
import { z } from "zod";

export interface OutboundItem {
  ref: string;
  provider: "simulated" | "whatsapp_cloud";
  external_account_id: string;
  to: string;
  body: string;
  kind: "text" | "template";
  template_code: string | null;
  template_params: string[] | null;
}
export type SendResult =
  | { outcome: "sent"; provider_message_id: string }
  | { outcome: "failed"; reason: string }
  | { outcome: "delivery_unknown" };

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
  /** Assinatura do webhook sobre o corpo bruto. */
  verifySignature(rawBody: string, header: string | null): Promise<boolean>;
  /** Corpo do webhook → eventos normalizados. Formato inesperado = lista vazia (nunca lança). */
  normalize(body: unknown): NormalizedEvent[];
}

const enc = new TextEncoder();
const hex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");

export async function hmacSha256Hex(secret: string, text: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, enc.encode(text)));
}

/** Comparação em tempo constante. */
export function sameHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyHubSignature(secret: string, rawBody: string, header: string | null): Promise<boolean> {
  if (!header?.startsWith("sha256=")) return false;
  const expected = await hmacSha256Hex(secret, rawBody);
  return sameHex(header.slice(7).toLowerCase(), expected);
}

// ---------------------------------------------------------------------------
// Simulado
// ---------------------------------------------------------------------------

/** Corpo do webhook simulado: a mesma lista de eventos normalizados, assinada com o segredo do simulador. */
export const SimulatedWebhookBody = z.object({
  events: z.array(z.object({
    external_event_id: z.string().min(1).max(200),
    kind: z.enum(["inbound", "status"]),
    external_account_id: z.string().min(1).max(80),
    phone_e164: z.string().optional(),
    text: z.string().max(4096).optional(),
    profile_name: z.string().max(120).optional(),
    provider_message_id: z.string().max(200).optional(),
    status: z.enum(["sent", "delivered", "read", "failed"]).optional(),
    reason: z.string().max(200).optional(),
  })).max(500),
});

export interface SimulatedDeps {
  secret: string;
  /** Guarda a mensagem "entregue" no telefone fictício (RPC channel_sim_deliver, só backend). */
  deliver(phone: string, fromAccount: string, body: string, providerMessageId: string): Promise<void>;
}

export function createSimulatedProvider(deps: SimulatedDeps): Provider {
  const unknownOnce = new Set<string>();
  return {
    name: "simulated",
    configured: deps.secret.length >= 16,
    async send(item) {
      if (item.to.endsWith("0000")) return { outcome: "failed", reason: "invalid_number" };
      if (item.to.endsWith("9999") && !unknownOnce.has(item.ref)) {
        // Primeira vez: timeout sem resposta. A consulta de status resolve.
        unknownOnce.add(item.ref);
        return { outcome: "delivery_unknown" };
      }
      const id = `sim-${item.ref.replace(/[^a-z0-9]/gi, "").slice(-24)}-${Date.now().toString(36)}`;
      await deps.deliver(item.to, item.external_account_id, item.body, id);
      return { outcome: "sent", provider_message_id: id };
    },
    async status(_providerMessageId, ref) {
      return unknownOnce.has(ref) ? "sent" : null;
    },
    verifySignature: (raw, header) => verifyHubSignature(deps.secret, raw, header),
    normalize(body) {
      const parsed = SimulatedWebhookBody.safeParse(body);
      return parsed.success ? parsed.data.events : [];
    },
  };
}

// ---------------------------------------------------------------------------
// WhatsApp Cloud API (oficial). Formato dos webhooks: entry[].changes[].value.{metadata, messages[], statuses[]}.
// ---------------------------------------------------------------------------

export interface WhatsAppDeps {
  accessToken: string | null;
  appSecret: string | null;
  graphUrl?: string;
  fetch?: typeof fetch;
}

const WaWebhook = z.object({
  object: z.string().optional(),
  entry: z.array(z.object({
    changes: z.array(z.object({
      value: z.object({
        metadata: z.object({ phone_number_id: z.string() }).optional(),
        contacts: z.array(z.object({ wa_id: z.string().optional(), profile: z.object({ name: z.string().optional() }).optional() })).optional(),
        messages: z.array(z.object({
          id: z.string(), from: z.string(), type: z.string().optional(), text: z.object({ body: z.string() }).optional(),
        })).optional(),
        statuses: z.array(z.object({
          id: z.string(), status: z.string(), recipient_id: z.string().optional(),
          errors: z.array(z.object({ code: z.number().optional(), title: z.string().optional() })).optional(),
        })).optional(),
      }),
    })),
  })),
});

const toE164 = (waId: string) => (waId.startsWith("+") ? waId : `+${waId}`);

export function createWhatsAppProvider(deps: WhatsAppDeps): Provider {
  const doFetch = deps.fetch ?? fetch;
  const base = (deps.graphUrl ?? "https://graph.facebook.com/v21.0").replace(/\/$/, "");
  const configured = !!deps.accessToken && !!deps.appSecret;
  return {
    name: "whatsapp_cloud",
    configured,
    async send(item) {
      if (!configured) return { outcome: "delivery_unknown" };
      const payload = item.kind === "template" && item.template_code
        ? { messaging_product: "whatsapp", to: item.to.replace(/^\+/, ""), type: "template", template: {
            name: item.template_code, language: { code: "pt_BR" },
            components: [{ type: "body", parameters: (item.template_params ?? []).map((p) => ({ type: "text", text: p })) }] } }
        : { messaging_product: "whatsapp", to: item.to.replace(/^\+/, ""), type: "text", text: { body: item.body } };
      let res: Response;
      try {
        res = await doFetch(`${base}/${encodeURIComponent(item.external_account_id)}/messages`, {
          method: "POST", headers: { Authorization: `Bearer ${deps.accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify(payload),
          signal: AbortSignal.timeout(10_000),
        });
      } catch {
        // Timeout ou rede: a mensagem PODE ter saído. Resultado desconhecido, sem reenvio.
        return { outcome: "delivery_unknown" };
      }
      if (res.status >= 500) return { outcome: "delivery_unknown" };
      const json = await res.json().catch(() => null) as { messages?: { id: string }[]; error?: { message?: string; code?: number } } | null;
      if (!res.ok) return { outcome: "failed", reason: `graph_${res.status}${json?.error?.code ? `_${json.error.code}` : ""}` };
      const id = json?.messages?.[0]?.id;
      return id ? { outcome: "sent", provider_message_id: id } : { outcome: "delivery_unknown" };
    },
    async status() {
      // A API oficial não oferece consulta de status: só o webhook avança. Fica desconhecido até lá.
      return null;
    },
    verifySignature: (raw, header) => (deps.appSecret ? verifyHubSignature(deps.appSecret, raw, header) : Promise.resolve(false)),
    normalize(body) {
      const parsed = WaWebhook.safeParse(body);
      if (!parsed.success) return [];
      const out: NormalizedEvent[] = [];
      for (const entry of parsed.data.entry) {
        for (const change of entry.changes) {
          const v = change.value;
          const account = v.metadata?.phone_number_id;
          if (!account) continue;
          const names = new Map((v.contacts ?? []).map((c) => [c.wa_id ?? "", c.profile?.name]));
          for (const m of v.messages ?? []) {
            if (m.type && m.type !== "text") continue; // Mídia e outros tipos: fora do piloto.
            if (!m.text?.body) continue;
            out.push({ external_event_id: `msg:${m.id}`, kind: "inbound", external_account_id: account, phone_e164: toE164(m.from),
              text: m.text.body, profile_name: names.get(m.from) });
          }
          for (const s of v.statuses ?? []) {
            const status = s.status === "sent" || s.status === "delivered" || s.status === "read" || s.status === "failed" ? s.status : null;
            if (!status) continue;
            out.push({ external_event_id: `st:${s.id}:${status}`, kind: "status", external_account_id: account, provider_message_id: s.id, status,
              reason: s.errors?.[0]?.title ?? (s.errors?.[0]?.code ? `code_${s.errors[0].code}` : undefined) });
          }
        }
      }
      return out;
    },
  };
}
