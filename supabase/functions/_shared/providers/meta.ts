// Adaptador do WhatsApp oficial pela Cloud API da Meta (Graph). Nome interno `whatsapp_cloud`; escolhido pelo segredo
// MESSAGING_PROVIDER=meta (selection.ts). Só com WHATSAPP_ACCESS_TOKEN e WHATSAPP_APP_SECRET; sem eles,
// `configured: false` e conectar/despachar responde 503 ou falha com motivo, nunca cai no simulado.
//
// Regras (ADR-0017 e bloco 2 de docs/handoffs/INTEGRACOES-REAIS-claude.md):
// * 2xx com id = enviado (aceito pela Meta). Entregue e lido só pelo webhook.
// * 5xx, tempo esgotado ou rede = 'delivery_unknown' (a mensagem PODE ter saído): sem reenvio.
// * 429 e os códigos de limite conhecidos = 'retry' (nada saiu): volta para a fila do banco com espera crescente.
// * Outros 4xx = falha com o código (motivo legível para os códigos conhecidos).
// * Webhook: X-Hub-Signature-256 (HMAC-SHA256 do app secret sobre o corpo bruto) antes de qualquer leitura.
// Formato da Graph conforme o contrato público conhecido; cada ponto a conferir está no handoff do bloco 2.
import { z } from "zod";
import { type LimitScope, type LookupResult, type NormalizedEvent, type OutboundItem, type Provider, type SendResult, verifyHubSignature } from "../domain/messaging/port.ts";

export const GRAPH_URL = "https://graph.facebook.com/v21.0";
export const SEND_TIMEOUT_MS = 10_000;
export const LOOKUP_TIMEOUT_MS = 5_000;

/** Códigos de limite da Graph tratados como falha TEMPORÁRIA (nada saiu): voltam para a fila. */
export const GRAPH_LIMIT_CODES: Readonly<Record<number, { reason: string; scope: LimitScope }>> = {
  4: { reason: "app_rate_limit", scope: "account" },
  80007: { reason: "account_rate_limit", scope: "account" },
  130429: { reason: "throughput_limit", scope: "number" },
  131056: { reason: "pair_rate_limit", scope: "pair" },
};

/** Códigos de falha final com motivo legível (os demais viram graph_<http>_<código>). */
export const GRAPH_FAILURE_CODES: Readonly<Record<number, string>> = {
  190: "token_invalid",
  131021: "recipient_is_sender",
  131026: "undeliverable",
  131047: "window_closed",
  131048: "spam_rate_limit",
  131049: "meta_marketing_limit",
  131050: "recipient_stopped_marketing",
  131051: "unsupported_type",
  132000: "template_params_mismatch",
  132001: "template_not_found",
  133010: "number_not_registered",
};

export interface WhatsAppDeps {
  accessToken: string | null;
  appSecret: string | null;
  graphUrl?: string;
  fetch?: typeof fetch;
  /** Tempo máximo de um envio (padrão 10 s). */
  timeoutMs?: number;
  /** Tempo máximo da leitura do número (padrão 5 s). */
  lookupTimeoutMs?: number;
}

const GraphError = z.object({ error: z.object({ code: z.number().optional(), message: z.string().optional() }).optional() }).passthrough();

const WaWebhook = z.object({
  object: z.string().optional(),
  entry: z.array(z.object({
    changes: z.array(z.object({
      value: z.object({
        metadata: z.object({ phone_number_id: z.string() }).optional(),
        contacts: z.array(z.object({ wa_id: z.string().optional(), profile: z.object({ name: z.string().optional() }).optional() })).optional(),
        messages: z.array(z.object({
          id: z.string(),
          from: z.string(),
          type: z.string().optional(),
          text: z.object({ body: z.string() }).optional(),
          // Resposta por botão de modelo (ex.: "SAIR" como resposta rápida).
          button: z.object({ text: z.string().optional(), payload: z.string().optional() }).optional(),
          interactive: z.object({
            button_reply: z.object({ title: z.string().optional() }).optional(),
            list_reply: z.object({ title: z.string().optional() }).optional(),
          }).optional(),
        })).optional(),
        statuses: z.array(z.object({
          id: z.string(),
          status: z.string(),
          recipient_id: z.string().optional(),
          errors: z.array(z.object({ code: z.number().optional(), title: z.string().optional() })).optional(),
        })).optional(),
      }),
    })),
  })),
});

const toE164 = (waId: string) => (waId.startsWith("+") ? waId : `+${waId}`);
const digits = (v: string) => v.replace(/\D+/g, "");
/** A Meta recusa parâmetro com quebra de linha, tabulação ou mais de 4 espaços seguidos. */
export const cleanParam = (p: string) => p.replace(/[\r\n\t]+/g, " ").replace(/ {4,}/g, "   ").trim();

/** Motivo legível de um código da Graph (envio ou status do webhook). */
export function graphReason(httpStatus: number | null, code: number | undefined): string {
  if (code !== undefined && GRAPH_FAILURE_CODES[code]) return GRAPH_FAILURE_CODES[code];
  return `graph_${httpStatus ?? "status"}${code !== undefined ? `_${code}` : ""}`;
}

function retryAfter(res: Response): number | undefined {
  const v = Number(res.headers.get("retry-after"));
  return Number.isFinite(v) && v > 0 ? Math.min(Math.ceil(v), 3600) : undefined;
}

/** Corpo do POST /{phone_number_id}/messages. null = o item não pode ir para a Meta (motivo em `reason`). */
export function buildPayload(item: OutboundItem): { payload: Record<string, unknown> } | { reason: string } {
  const to = digits(item.to);
  if (item.kind === "text") {
    return { payload: { messaging_product: "whatsapp", recipient_type: "individual", to, type: "text", text: { preview_url: false, body: item.body } } };
  }
  const t = item.provider_template;
  if (!t) return { reason: "template_not_mapped" };
  const params = t.params.map(cleanParam);
  if (params.some((p) => p === "")) return { reason: "template_param_empty" };
  const text = params.map((p) => ({ type: "text", text: p }));
  const components: Record<string, unknown>[] = text.length ? [{ type: "body", parameters: text }] : [];
  // Modelo de autenticação: o código vai no corpo E no botão de copiar código (url, índice 0).
  if (t.category === "authentication" && params[0]) {
    components.push({ type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: params[0] }] });
  }
  return { payload: { messaging_product: "whatsapp", recipient_type: "individual", to, type: "template",
    template: { name: t.name, language: { code: t.language }, ...(components.length ? { components } : {}) } } };
}

export function createWhatsAppProvider(deps: WhatsAppDeps): Provider {
  const doFetch = deps.fetch ?? fetch;
  const base = (deps.graphUrl ?? GRAPH_URL).replace(/\/$/, "");
  const configured = !!deps.accessToken && !!deps.appSecret;
  const auth = { Authorization: `Bearer ${deps.accessToken ?? ""}` };
  return {
    name: "whatsapp_cloud",
    configured,
    async send(item): Promise<SendResult> {
      if (!configured) return { outcome: "failed", reason: "provider_not_configured" };
      const built = buildPayload(item);
      if ("reason" in built) return { outcome: "failed", reason: built.reason };
      let res: Response;
      try {
        res = await doFetch(`${base}/${encodeURIComponent(item.external_account_id)}/messages`, {
          method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify(built.payload),
          signal: AbortSignal.timeout(deps.timeoutMs ?? SEND_TIMEOUT_MS),
        });
      } catch {
        // Timeout ou rede: a mensagem PODE ter saído. Resultado desconhecido, sem reenvio.
        return { outcome: "delivery_unknown" };
      }
      if (res.status >= 500) return { outcome: "delivery_unknown" };
      const json = await res.json().catch(() => null) as unknown;
      const code = GraphError.safeParse(json).data?.error?.code;
      const limit = code !== undefined ? GRAPH_LIMIT_CODES[code] : undefined;
      if (res.status === 429 || (limit && !res.ok)) {
        return { outcome: "retry", reason: limit?.reason ?? "rate_limited", scope: limit?.scope ?? "number", retry_after_s: retryAfter(res) };
      }
      if (!res.ok) return { outcome: "failed", reason: graphReason(res.status, code) };
      const id = (json as { messages?: { id?: unknown }[] } | null)?.messages?.[0]?.id;
      return typeof id === "string" && id ? { outcome: "sent", provider_message_id: id } : { outcome: "delivery_unknown" };
    },
    async status() {
      // A Cloud API não oferece consulta de status de mensagem: só o webhook avança. Fica desconhecido até lá.
      return null;
    },
    async lookup(externalAccountId): Promise<LookupResult> {
      if (!configured) return { outcome: "unavailable" };
      let res: Response;
      try {
        res = await doFetch(`${base}/${encodeURIComponent(externalAccountId)}?fields=display_phone_number,verified_name,quality_rating`, {
          method: "GET", headers: auth, signal: AbortSignal.timeout(deps.lookupTimeoutMs ?? LOOKUP_TIMEOUT_MS),
        });
      } catch {
        return { outcome: "unavailable" };
      }
      if (res.status >= 500 || res.status === 429) return { outcome: "unavailable" };
      const json = await res.json().catch(() => null) as Record<string, unknown> | null;
      if (!res.ok) return { outcome: "not_found", reason: graphReason(res.status, GraphError.safeParse(json).data?.error?.code) };
      const display = typeof json?.display_phone_number === "string" ? json.display_phone_number : null;
      if (!display) return { outcome: "not_found", reason: "no_display_phone_number" };
      return { outcome: "found", display_phone_number: display,
        verified_name: typeof json?.verified_name === "string" ? json.verified_name : null,
        quality_rating: typeof json?.quality_rating === "string" ? json.quality_rating : null };
    },
    verifySignature: (raw, header) => (deps.appSecret ? verifyHubSignature(deps.appSecret, raw, header) : Promise.resolve(false)),
    normalize(body) {
      const parsed = WaWebhook.safeParse(body);
      if (!parsed.success) return [];
      if (parsed.data.object !== undefined && parsed.data.object !== "whatsapp_business_account") return [];
      const out: NormalizedEvent[] = [];
      for (const entry of parsed.data.entry) {
        for (const change of entry.changes) {
          const v = change.value;
          const account = v.metadata?.phone_number_id;
          if (!account) continue;
          const names = new Map((v.contacts ?? []).map((c) => [c.wa_id ?? "", c.profile?.name]));
          for (const m of v.messages ?? []) {
            // Texto, ou o texto do botão tocado. Mídia e outros tipos: fora do piloto.
            const text = m.type === undefined || m.type === "text" ? m.text?.body
              : m.type === "button" ? m.button?.text
              : m.type === "interactive" ? (m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title)
              : undefined;
            if (!text) continue;
            out.push({ external_event_id: `msg:${m.id}`, kind: "inbound", external_account_id: account, phone_e164: toE164(m.from),
              text, profile_name: names.get(m.from) });
          }
          for (const s of v.statuses ?? []) {
            const status = s.status === "sent" || s.status === "delivered" || s.status === "read" || s.status === "failed" ? s.status : null;
            if (!status) continue;
            const err = s.errors?.[0];
            out.push({ external_event_id: `st:${s.id}:${status}`, kind: "status", external_account_id: account, provider_message_id: s.id, status,
              reason: status === "failed" ? (err?.code !== undefined ? graphReason(null, err.code) : (err?.title?.slice(0, 200) ?? "provider")) : undefined });
          }
        }
      }
      return out;
    },
  };
}
