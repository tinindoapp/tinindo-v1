// Edge Function `messaging` (P12): canal oficial de mensagens.
// Rotas do dono: uma RPC transacional cada (rpc-handler), com o JWT do usuário.
// Rotas de sistema, com a chave de serviço SÓ aqui (como `jobs`):
//  * channel.webhook/<provider>: GET = desafio de verificação (API oficial); POST = assinatura sobre o corpo bruto →
//    normalização → channel_webhook_ingest (deduplica no banco). Assinatura inválida = 401 e nada é lido.
//  * channel.dispatch: segredo no header → reserva a fila → provedor.send → resultado; depois consulta de status dos
//    desconhecidos (nunca reenvio). Limite do provedor (429 e códigos de limite) = 'retry': volta para a fila do banco
//    com espera crescente; o resto da rodada daquele número (ou par, ou conta) volta sem chamar ('requeue').
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
  InboxUnreadCountInput,
  InboxUnreadCountOutput,
  MessageSendInput,
  MessageSendOutput,
  SimInboundInput,
  SimInboundOutput,
  SimPhoneInput,
  SimPhoneOutput,
  TENANT_HEADER,
} from "../_shared/contracts/index.ts";
import { hmacSha256Hex, type OutboundItem, type Provider, sameHex, type SendResult } from "../_shared/domain/messaging/providers.ts";
import { mapDbError } from "../_shared/http/errors.ts";
import { activeInfo, type MessagingProviderName, type ProviderChoice, withProvider, withProviderInfo } from "../_shared/providers/selection.ts";
import { corsHeaders, fail, isUuid, ok, requestIdFrom, systemClock } from "../_shared/http/respond.ts";
import { createRpcHandler, type Route, route, type RpcHandlerDeps, type RpcResult } from "../_shared/http/rpc-handler.ts";

export const DISPATCH_SECRET_HEADER = "X-Tinindo-Dispatch-Secret";
export const SIGNATURE_HEADER = "X-Hub-Signature-256";

export interface MessagingDeps extends RpcHandlerDeps {
  /** RPCs de sistema (ingestão, despacho, telefone simulado) com a chave de serviço. Nunca para rotas do dono. */
  serviceRpc(fn: string, args: Record<string, unknown>): Promise<RpcResult>;
  providers: Partial<Record<z.infer<typeof ChannelProvider>, Provider>>;
  /** Provedor escolhido pelo segredo MESSAGING_PROVIDER (padrão simulado). Conexão nova nasce nele. */
  choice?: ProviderChoice<MessagingProviderName>;
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
    args: (i) => ({ p_provider: i.provider, p_phone_e164: i.phone_e164, p_external_account_id: i.external_account_id ?? null,
      p_verify_to_e164: i.verify_to_e164 ?? null }),
  }),
  "channel.verify": route({ rpc: "channel_verify", input: ChannelVerifyInput, output: ChannelConnectionOutput, command: true, args: (i) => ({ p_code: i.code }) }),
  "channel.disconnect": route({ rpc: "channel_disconnect", input: ChannelDisconnectInput, output: ChannelConnectionOutput, command: true, args: () => ({}) }),
  "inbox.list": route({ rpc: "channel_inbox", input: InboxListInput, output: InboxListOutput, command: false, args: () => ({}) }),
  "inbox.unread_count": route({ rpc: "channel_unread_count", input: InboxUnreadCountInput, output: InboxUnreadCountOutput, command: false, args: () => ({}) }),
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
  const choice: ProviderChoice<MessagingProviderName> = deps.choice ?? { active: "simulated", real: false, missing: [], problems: [] };
  const info = () => ({ ...activeInfo(choice), configured: choice.missing.length === 0 && !!deps.providers[choice.active]?.configured });

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
    else if (name === "channel.status") return withProviderInfo(await owner(req), info(), cors);
    else return owner(req);
    deps.log?.({ fn: "messaging", route: name, request_id: requestId, status: res.status, ms: clock.now().getTime() - started });
    return res;
  };

  /**
   * O número nasce no provedor ativo (segredo MESSAGING_PROVIDER), qualquer que seja o `provider` do corpo. Provedor
   * real sem os segredos: 503 antes de gravar qualquer coisa. Na Meta, antes do banco: phone_number_id e o WhatsApp
   * pessoal que recebe o código são obrigatórios, e a Graph precisa reconhecer o phone_number_id com o MESMO número.
   */
  async function connect(req: Request, cors: Record<string, string>): Promise<Response> {
    const requestId = requestIdFrom(req);
    if (!info().configured) {
      return fail("PROVIDER_UNAVAILABLE", requestId, { message: "O WhatsApp oficial não está configurado neste ambiente.", extra: cors });
    }
    const provider = deps.providers[choice.active];
    if (choice.active === "whatsapp_cloud" && req.method === "POST" && provider?.lookup) {
      const body = ChannelConnectInput.safeParse(await req.clone().json().catch(() => null));
      // Corpo inválido segue para o rpc-handler, que responde com o campo certo.
      if (body.success) {
        const i = body.data;
        if (!i.external_account_id || !/^[0-9]{5,30}$/.test(i.external_account_id)) {
          return fail("VALIDATION_ERROR", requestId, { field: "external_account_id", message: "Informe o ID do número na Meta (phone_number_id), só números.", extra: cors });
        }
        if (!i.verify_to_e164 || i.verify_to_e164 === i.phone_e164) {
          return fail("VALIDATION_ERROR", requestId, { field: "verify_to_e164", message: "Informe o seu WhatsApp pessoal para receber o código (diferente do número do negócio).", extra: cors });
        }
        // Só o dono chega à Graph: o banco decide (channel_status com o JWT do dono).
        const auth = req.headers.get("Authorization") ?? "";
        const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
        const tenantId = req.headers.get(TENANT_HEADER);
        if (token && isUuid(tenantId)) {
          const status = await deps.rpc(token, "channel_status", { p_tenant_id: tenantId }).catch(() => null);
          if (!status) return fail("PROVIDER_UNAVAILABLE", requestId, { extra: cors });
          if (status.error) return fail(mapDbError(status.error).code, requestId, { extra: cors });
          const found = await provider.lookup(i.external_account_id).catch(() => ({ outcome: "unavailable" as const }));
          if (found.outcome === "unavailable") {
            return fail("PROVIDER_UNAVAILABLE", requestId, { message: "A Meta não respondeu agora. Nada foi gravado; tente de novo em instantes.", extra: cors });
          }
          if (found.outcome === "not_found") {
            return fail("POLICY_REJECTED", requestId, { field: "external_account_id", message: "A Meta não reconhece este ID de número para a Tinindo.", extra: cors });
          }
          if (found.display_phone_number.replace(/\D+/g, "") !== i.phone_e164.replace(/\D+/g, "")) {
            return fail("POLICY_REJECTED", requestId, { field: "display_phone_number", message: "O ID informado é de outro número na Meta.", extra: cors });
          }
        }
      }
    }
    return owner(await withProvider(req, choice.active));
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
    const declared = Number(req.headers.get("Content-Length") ?? "0");
    if (declared > MAX_WEBHOOK_BYTES) return fail("VALIDATION_ERROR", requestId, { message: "Corpo grande demais." });
    const bytes = new Uint8Array(await req.arrayBuffer().catch(() => new ArrayBuffer(0)));
    if (bytes.byteLength > MAX_WEBHOOK_BYTES) return fail("VALIDATION_ERROR", requestId, { message: "Corpo grande demais." });
    // A assinatura é conferida sobre os BYTES como chegaram, antes de qualquer parse.
    if (!(await provider.verifySignature(bytes, req.headers.get(SIGNATURE_HEADER)))) return fail("AUTH_REQUIRED", requestId);
    let json: unknown;
    try {
      json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
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
    const result = { provider_configured: true, sent: 0, failed: 0, unknown: 0, retried: 0, reconciled: 0 };
    let claim: RpcResult;
    try {
      claim = await deps.serviceRpc("channel_dispatch_claim", { p_batch: 50 });
    } catch {
      return fail("PROVIDER_UNAVAILABLE", requestId);
    }
    if (claim.error) return fail(mapDbError(claim.error).code, requestId);
    const items = ((claim.data as { items?: OutboundItem[] } | null)?.items ?? []);
    // Limite batido nesta rodada: o resto do número (ou do par número→cliente, ou da conta) não chama o provedor.
    const limited = { account: new Set<string>(), number: new Set<string>(), pair: new Set<string>() };
    const pairKey = (i: OutboundItem) => `${i.provider}|${i.external_account_id}|${i.to}`;
    const numberKey = (i: OutboundItem) => `${i.provider}|${i.external_account_id}`;
    for (const item of items) {
      const provider = deps.providers[item.provider];
      let outcome: SendResult | { outcome: "requeue"; reason: string };
      if (!provider?.configured) {
        result.provider_configured = false;
        outcome = { outcome: "failed", reason: "provider_not_configured" };
      } else if (limited.account.has(item.provider) || limited.number.has(numberKey(item)) || limited.pair.has(pairKey(item))) {
        outcome = { outcome: "requeue", reason: "rate_limited_round" };
      } else {
        try {
          outcome = await provider.send(item);
        } catch {
          outcome = { outcome: "delivery_unknown" };
        }
        if (outcome.outcome === "retry") {
          if (outcome.scope === "account") limited.account.add(item.provider);
          else if (outcome.scope === "number") limited.number.add(numberKey(item));
          else limited.pair.add(pairKey(item));
        }
      }
      await deps.serviceRpc("channel_dispatch_result", { p_ref: item.ref, p_outcome: outcome.outcome,
        p_provider_message_id: outcome.outcome === "sent" ? outcome.provider_message_id : null,
        p_reason: "reason" in outcome ? outcome.reason : null,
        p_retry_after_s: outcome.outcome === "retry" ? (outcome.retry_after_s ?? null) : null }).catch(() => undefined);
      if (outcome.outcome === "sent") result.sent++;
      else if (outcome.outcome === "failed") result.failed++;
      else if (outcome.outcome === "retry" || outcome.outcome === "requeue") result.retried++;
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
