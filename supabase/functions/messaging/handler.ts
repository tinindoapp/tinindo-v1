// Edge Function `messaging` (P12): canal oficial de mensagens.
// Rotas do dono: uma RPC transacional cada (rpc-handler), com o JWT do usuário.
// Rotas de sistema, com a chave de serviço SÓ aqui (como `jobs`):
//  * channel.webhook/<provider>: GET = desafio de verificação (API oficial); POST = assinatura sobre o corpo bruto →
//    normalização → channel_webhook_ingest (deduplica no banco). Assinatura inválida = 401 e nada é lido.
//  * channel.dispatch: segredo no header → reserva a fila → provedor.send → resultado; depois consulta de status dos
//    desconhecidos (nunca reenvio). Provedor não configurado = 503 explícito.
//  * sim.inbound (dono, só conexão simulada): monta um webhook simulado ASSINADO e o entrega ao mesmo caminho.
// Log técnico sem telefone, texto, token ou tenant.
import type { z } from "zod";
import {
  ChannelConnectInput,
  ChannelConnectionOutput,
  ChannelDisconnectInput,
  ChannelProvider,
  ChannelStatusInput,
  ChannelStatusOutput,
  ChannelVerifyInput,
  ContactConsentInput,
  ContactLinkInput,
  ContactOutput,
  ConversationGetInput,
  ConversationGetOutput,
  ConversationHandoffInput,
  DispatchOutput,
  IDEMPOTENCY_HEADER,
  IdempotencyKey,
  InboxListInput,
  InboxListOutput,
  MessageSendInput,
  MessageSendOutput,
  SimInboundInput,
  SimInboundOutput,
  SimPhoneInput,
  SimPhoneOutput,
  TENANT_HEADER,
} from "../_shared/contracts/index.ts";
import { hmacSha256Hex, type OutboundItem, type Provider, sameHex } from "../_shared/domain/messaging/providers.ts";
import { mapDbError } from "../_shared/http/errors.ts";
import { corsHeaders, fail, isUuid, ok, requestIdFrom, systemClock } from "../_shared/http/respond.ts";
import { createRpcHandler, type Route, route, type RpcHandlerDeps, type RpcResult } from "../_shared/http/rpc-handler.ts";

export const DISPATCH_SECRET_HEADER = "X-Tinindo-Dispatch-Secret";
export const SIGNATURE_HEADER = "X-Hub-Signature-256";

export interface MessagingDeps extends RpcHandlerDeps {
  /** RPCs de sistema (ingestão, despacho, telefone simulado) com a chave de serviço. Nunca para rotas do dono. */
  serviceRpc(fn: string, args: Record<string, unknown>): Promise<RpcResult>;
  providers: Partial<Record<z.infer<typeof ChannelProvider>, Provider>>;
  dispatchSecret: string;
  /** Token do desafio GET da API oficial (hub.verify_token). */
  verifyToken: string | null;
  /** Segredo do simulador: assina o webhook montado por sim.inbound. */
  simulatedSecret: string;
}

export const MESSAGING_ROUTES: Record<string, Route> = {
  "channel.status": route({ rpc: "channel_status", input: ChannelStatusInput, output: ChannelStatusOutput, command: false, args: () => ({}) }),
  "channel.connect": route({
    rpc: "channel_connect", input: ChannelConnectInput, output: ChannelConnectionOutput, command: true,
    args: (i) => ({ p_provider: i.provider, p_phone_e164: i.phone_e164, p_external_account_id: i.external_account_id ?? null }),
  }),
  "channel.verify": route({ rpc: "channel_verify", input: ChannelVerifyInput, output: ChannelConnectionOutput, command: true, args: (i) => ({ p_code: i.code }) }),
  "channel.disconnect": route({ rpc: "channel_disconnect", input: ChannelDisconnectInput, output: ChannelConnectionOutput, command: true, args: () => ({}) }),
  "inbox.list": route({ rpc: "channel_inbox", input: InboxListInput, output: InboxListOutput, command: false, args: () => ({}) }),
  "conversation.get": route({ rpc: "channel_conversation", input: ConversationGetInput, output: ConversationGetOutput, command: false, args: (i) => ({ p_contact_id: i.contact_id }) }),
  "message.send": route({
    rpc: "channel_send", input: MessageSendInput, output: MessageSendOutput, command: true,
    args: (i) => ({
      p_contact_id: i.contact_id, p_kind: i.kind, p_text: i.kind === "text" ? i.text : null,
      p_template_code: i.kind === "template" ? i.template_code : null, p_template_params: i.kind === "template" ? i.template_params : null,
    }),
  }),
  "conversation.handoff": route({ rpc: "channel_handoff", input: ConversationHandoffInput, output: ContactOutput, command: true, args: (i) => ({ p_contact_id: i.contact_id, p_handling: i.handling }) }),
  "contact.link": route({ rpc: "channel_contact_link", input: ContactLinkInput, output: ContactOutput, command: true, args: (i) => ({ p_contact_id: i.contact_id, p_customer_id: i.customer_id }) }),
  "contact.consent": route({ rpc: "channel_contact_consent", input: ContactConsentInput, output: ContactOutput, command: true, args: (i) => ({ p_contact_id: i.contact_id, p_opted_in: i.opted_in }) }),
  "sim.phone": route({ rpc: "channel_sim_phone", input: SimPhoneInput, output: SimPhoneOutput, command: false, args: (i) => ({ p_phone_e164: i.phone_e164 }) }),
};

const ROUTE_RE = /\/messaging\/([a-z_.]+)(?:\/([a-z_]+))?\/?$/;
const MAX_WEBHOOK_BYTES = 256 * 1024;

export function createMessagingHandler(deps: MessagingDeps) {
  const clock = deps.clock ?? systemClock;
  if (deps.dispatchSecret.length < 32) throw new Error("MESSAGING_DISPATCH_SECRET precisa de pelo menos 32 caracteres");
  const owner = createRpcHandler("messaging", MESSAGING_ROUTES, deps);

  return async (req: Request): Promise<Response> => {
    const m = ROUTE_RE.exec(new URL(req.url).pathname);
    const name = m?.[1] ?? "";
    const started = clock.now().getTime();
    const requestId = requestIdFrom(req);
    const cors = corsHeaders(req, deps.allowedOrigins);
    let res: Response;
    if (name === "channel.webhook") res = await webhook(req, m?.[2] ?? "", requestId);
    else if (name === "channel.dispatch") res = await dispatch(req, requestId);
    else if (name === "sim.inbound") res = await simInbound(req, requestId, cors);
    else if (name === "channel.connect") res = await connect(req, cors);
    else return owner(req);
    deps.log?.({ fn: "messaging", route: name, request_id: requestId, status: res.status, ms: clock.now().getTime() - started });
    return res;
  };

  /** Conectar um provedor real sem segredos no ambiente: 503 antes de gravar qualquer coisa. */
  async function connect(req: Request, cors: Record<string, string>): Promise<Response> {
    const clone = req.clone();
    const body = await clone.json().catch(() => null) as { provider?: unknown } | null;
    const provider = typeof body?.provider === "string" ? deps.providers[body.provider as z.infer<typeof ChannelProvider>] : undefined;
    if (body?.provider === "whatsapp_cloud" && !provider?.configured) {
      return fail("PROVIDER_UNAVAILABLE", requestIdFrom(req), { message: "O provedor oficial não está configurado neste ambiente.", extra: cors });
    }
    return owner(req);
  }

  async function webhook(req: Request, providerName: string, requestId: string): Promise<Response> {
    const parsedName = ChannelProvider.safeParse(providerName);
    const provider = parsedName.success ? deps.providers[parsedName.data] : undefined;
    if (!provider) return fail("NOT_FOUND", requestId);
    if (req.method === "GET") {
      // Desafio de verificação da API oficial. O simulado não tem desafio.
      const url = new URL(req.url);
      if (provider.name === "whatsapp_cloud" && deps.verifyToken && url.searchParams.get("hub.mode") === "subscribe"
        && sameHex(url.searchParams.get("hub.verify_token") ?? "", deps.verifyToken)) {
        return new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200, headers: { "Content-Type": "text/plain" } });
      }
      return fail("FORBIDDEN", requestId);
    }
    if (req.method !== "POST") return fail("VALIDATION_ERROR", requestId, { message: "Use POST." });
    const raw = await req.text().catch(() => "");
    if (new TextEncoder().encode(raw).byteLength > MAX_WEBHOOK_BYTES) return fail("VALIDATION_ERROR", requestId, { message: "Corpo grande demais." });
    // A assinatura é conferida sobre o corpo BRUTO, antes de qualquer parse.
    if (!(await provider.verifySignature(raw, req.headers.get(SIGNATURE_HEADER)))) return fail("AUTH_REQUIRED", requestId);
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return fail("VALIDATION_ERROR", requestId, { message: "JSON inválido." });
    }
    const events = provider.normalize(json);
    if (events.length === 0) return ok({ applied: 0, duplicates: 0 }, requestId, clock);
    let r: RpcResult;
    try {
      r = await deps.serviceRpc("channel_webhook_ingest", { p_provider: provider.name, p_events: events });
    } catch {
      // O provedor reenvia depois; o banco deduplica.
      return fail("PROVIDER_UNAVAILABLE", requestId);
    }
    if (r.error) return fail(mapDbError(r.error).code, requestId);
    const parsed = SimInboundOutput.safeParse(r.data);
    if (!parsed.success) return fail("INTERNAL_ERROR", requestId);
    return ok(parsed.data, requestId, clock);
  }

  async function dispatch(req: Request, requestId: string): Promise<Response> {
    if (req.method !== "POST") return fail("VALIDATION_ERROR", requestId, { message: "Use POST." });
    const given = req.headers.get(DISPATCH_SECRET_HEADER) ?? "";
    if (!sameHex(await hmacSha256Hex("k", given), await hmacSha256Hex("k", deps.dispatchSecret))) return fail("AUTH_REQUIRED", requestId);
    const result = { provider_configured: true, sent: 0, failed: 0, unknown: 0, reconciled: 0 };
    let claim: RpcResult;
    try {
      claim = await deps.serviceRpc("channel_dispatch_claim", { p_batch: 50 });
    } catch {
      return fail("PROVIDER_UNAVAILABLE", requestId);
    }
    if (claim.error) return fail(mapDbError(claim.error).code, requestId);
    const items = ((claim.data as { items?: OutboundItem[] } | null)?.items ?? []);
    for (const item of items) {
      const provider = deps.providers[item.provider];
      let outcome: { outcome: string; provider_message_id?: string; reason?: string };
      if (!provider?.configured) {
        result.provider_configured = false;
        outcome = { outcome: "failed", reason: "provider_not_configured" };
      } else {
        try {
          outcome = await provider.send(item);
        } catch {
          outcome = { outcome: "delivery_unknown" };
        }
      }
      await deps.serviceRpc("channel_dispatch_result", { p_ref: item.ref, p_outcome: outcome.outcome,
        p_provider_message_id: outcome.provider_message_id ?? null, p_reason: outcome.reason ?? null }).catch(() => undefined);
      if (outcome.outcome === "sent") result.sent++;
      else if (outcome.outcome === "failed") result.failed++;
      else result.unknown++;
    }
    // Desconhecidos antigos: consulta de status, nunca reenvio.
    const unknown = await deps.serviceRpc("channel_dispatch_unknown", { p_batch: 50 }).catch(() => null);
    const pending = ((unknown?.data as { items?: { ref: string; provider: z.infer<typeof ChannelProvider>; provider_message_id: string | null }[] } | null)?.items ?? []);
    for (const u of pending) {
      const provider = deps.providers[u.provider];
      const status = provider?.configured ? await provider.status(u.provider_message_id, u.ref).catch(() => null) : null;
      if (!status) continue;
      await deps.serviceRpc("channel_dispatch_result", { p_ref: u.ref, p_outcome: status, p_provider_message_id: u.provider_message_id, p_reason: status === "failed" ? "provider_status" : null }).catch(() => undefined);
      result.reconciled++;
    }
    const parsed = DispatchOutput.safeParse(result);
    return parsed.success ? ok(parsed.data, requestId, clock) : fail("INTERNAL_ERROR", requestId);
  }

  /** Só para conexão simulada: o cliente fictício escreve, ou o provedor fictício confirma entrega/leitura. */
  async function simInbound(req: Request, requestId: string, cors: Record<string, string>): Promise<Response> {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (req.method !== "POST") return fail("VALIDATION_ERROR", requestId, { message: "Use POST.", extra: cors });
    const auth = req.headers.get("Authorization") ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    if (!token) return fail("AUTH_REQUIRED", requestId, { extra: cors });
    const tenantId = req.headers.get(TENANT_HEADER);
    if (!isUuid(tenantId)) return fail("VALIDATION_ERROR", requestId, { field: "tenant_id", message: "Selecione um negócio.", extra: cors });
    const key = IdempotencyKey.safeParse(req.headers.get(IDEMPOTENCY_HEADER));
    if (!key.success) return fail("VALIDATION_ERROR", requestId, { field: "idempotency_key", message: "Envie o header Idempotency-Key.", extra: cors });
    const input = SimInboundInput.safeParse(await req.json().catch(() => null));
    if (!input.success) return fail("VALIDATION_ERROR", requestId, { field: input.error.issues[0]?.path.map(String).join(".") || undefined, extra: cors });
    // Só o dono de uma conexão SIMULADA ativa pode simular; o banco decide (channel_status com o JWT do dono).
    const status = await deps.rpc(token, "channel_status", { p_tenant_id: tenantId }).catch(() => null);
    if (!status || status.error) return fail(status?.error ? mapDbError(status.error).code : "PROVIDER_UNAVAILABLE", requestId, { extra: cors });
    const conn = (status.data as { connection?: { provider?: string; phone_e164?: string; status?: string } | null } | null)?.connection;
    if (!conn || conn.provider !== "simulated" || conn.status !== "active") return fail("POLICY_REJECTED", requestId, { field: "provider", extra: cors });
    const i = input.data;
    // A chave de idempotência vira o id do evento: repetir = evento duplicado, ignorado pelo banco.
    const event = i.kind === "inbound"
      ? { external_event_id: `sim:${key.data}`, kind: "inbound", external_account_id: conn.phone_e164, phone_e164: i.phone_e164, text: i.text, profile_name: i.profile_name }
      : { external_event_id: `sim:${key.data}`, kind: "status", external_account_id: conn.phone_e164, provider_message_id: i.provider_message_id, status: i.status, reason: i.status === "failed" ? "simulated_failure" : undefined };
    const raw = JSON.stringify({ events: [event] });
    const signature = `sha256=${await hmacSha256Hex(deps.simulatedSecret, raw)}`;
    const res = await webhook(new Request(`http://internal/functions/v1/messaging/channel.webhook/simulated`, {
      method: "POST", headers: { "Content-Type": "application/json", [SIGNATURE_HEADER]: signature }, body: raw }), "simulated", requestId);
    const json = await res.json().catch(() => null);
    if (!res.ok) return new Response(JSON.stringify(json), { status: res.status, headers: { "Content-Type": "application/json; charset=utf-8", ...cors } });
    return ok((json as { data: unknown }).data, requestId, clock, 200, cors);
  }
}
