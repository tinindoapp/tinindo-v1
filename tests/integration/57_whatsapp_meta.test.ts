// Bloco 2 · WhatsApp oficial de ponta a ponta com o banco real e a Graph FALSA (sem rede): MESSAGING_PROVIDER=meta;
// conectar confere o phone_number_id na Graph; o código sai como modelo de autenticação para o WhatsApp pessoal; o
// webhook assinado com o app secret entra; texto e modelo ({{1}} = negócio) saem pela Graph; entregue e lido pelo
// webhook; 429 volta para a fila com espera; SAIR falha o que estava na fila; a tabela de modelos do código = banco.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ChannelConnectionOutput, ChannelStatusOutput, ConversationGetOutput, ErrorEnvelope, IDEMPOTENCY_HEADER, InboxListOutput, MessageSendOutput, TENANT_HEADER } from "@contracts";
import type { z } from "zod";
import { createWhatsAppProvider } from "../../supabase/functions/_shared/providers/meta.ts";
import { META_TEMPLATES } from "../../supabase/functions/_shared/providers/meta-templates.ts";
import { messagingChoice } from "../../supabase/functions/_shared/providers/selection.ts";
import { createMessagingHandler, DISPATCH_SECRET_HEADER, SIGNATURE_HEADER } from "../../supabase/functions/messaging/handler.ts";
import { type FakeGraph, metaDelivery, startFakeGraph, webhookBody } from "../contracts/messaging/fake-graph.ts";
import { DISPATCH_SECRET, newKey, pool, rpc, SIM_SECRET, sql, T, U } from "./harness.ts";

const APP_SECRET = "app-secret-falso-".repeat(2);
const PHONE_ID = "5550001234";
const BUSINESS = "+5511955550001";
const OWNER_PHONE = "+5511955559999";
const ANA = "+5511944443333";
let graph: FakeGraph;
let handler: (req: Request) => Promise<Response>;

beforeAll(async () => {
  graph = await startFakeGraph();
  graph.numbers.set(PHONE_ID, "+55 11 95555-0001");
  // Negócio B sem número vivo (outros arquivos podem ter conectado o simulado).
  await sql("update public.channel_connections set status = 'disconnected', verified_at = null, disconnected_at = now() where tenant_id = $1 and status <> 'disconnected'", [T.B]);
  // A fila é compartilhada pelo banco da integração: o que os outros arquivos deixaram na fila não entra nesta conta.
  await sql("update public.channel_messages set status = 'failed', failure_reason = 'disconnected', failed_at = now() where status in ('queued', 'sending')");
  await sql("update public.channel_verifications set dispatch_status = 'failed' where dispatch_status in ('queued', 'sending')");
  await sql("update public.public_booking_requests set dispatch_status = 'failed' where dispatch_status in ('queued', 'sending')");
  const env: Record<string, string> = { MESSAGING_PROVIDER: "meta", WHATSAPP_ACCESS_TOKEN: "token-falso", WHATSAPP_APP_SECRET: APP_SECRET, WHATSAPP_VERIFY_TOKEN: "verifica-falso" };
  handler = createMessagingHandler({
    allowedOrigins: [], dispatchSecret: DISPATCH_SECRET, simulatedSecret: SIM_SECRET, verifyToken: env.WHATSAPP_VERIFY_TOKEN!,
    choice: messagingChoice((k) => env[k]),
    providers: { whatsapp_cloud: createWhatsAppProvider({ accessToken: "token-falso", appSecret: APP_SECRET, graphUrl: graph.graphUrl, timeoutMs: 500, lookupTimeoutMs: 500 }) },
    serviceRpc: (fn, args) => rpc("worker", fn, args),
    rpc: (token, fn, args) => rpc(token, fn, args),
  });
});
afterAll(async () => {
  await graph.close();
  await pool.end();
});

async function call(op: string, body: unknown, key = false) {
  const headers: Record<string, string> = { Authorization: `Bearer ${U.ownerB}`, [TENANT_HEADER]: T.B, "Content-Type": "application/json" };
  if (key) headers[IDEMPOTENCY_HEADER] = newKey();
  const res = await handler(new Request(`http://edge/functions/v1/messaging/${op}`, { method: "POST", headers, body: JSON.stringify(body) }));
  return { status: res.status, json: await res.json() as { data?: unknown; error?: unknown } };
}
async function ok<S extends z.ZodType>(schema: S, op: string, body: unknown, key = false): Promise<z.infer<S>> {
  const r = await call(op, body, key);
  if (r.status >= 300) throw new Error(`${op}: ${r.status} ${JSON.stringify(r.json)}`);
  return schema.parse(r.json.data);
}
const dispatch = async () => (await (await handler(new Request("http://edge/functions/v1/messaging/channel.dispatch", { method: "POST", headers: { [DISPATCH_SECRET_HEADER]: DISPATCH_SECRET } }))).json() as { data: Record<string, number> }).data;
const webhook = async (value: Record<string, unknown>, secret = APP_SECRET) => {
  const d = metaDelivery(webhookBody(PHONE_ID, value), secret);
  const res = await handler(new Request("http://edge/functions/v1/messaging/channel.webhook/whatsapp_cloud", { method: "POST", body: d.raw, headers: { [SIGNATURE_HEADER]: d.signature } }));
  return { status: res.status, data: (await res.json() as { data?: unknown }).data };
};
const sentTo = (to: string) => graph.requests.filter((r) => r.method === "POST" && (r.body as { to?: string } | null)?.to === to.replace("+", ""));

describe("WhatsApp oficial (Meta) com o banco real e a Graph falsa", () => {
  let contactId = "";

  it("0 · a tabela de modelos do código é a do banco (nome, categoria, idioma, corpo e origem das variáveis)", async () => {
    const rows = await sql<{ code: string; meta_name: string; meta_category: string; meta_language: string; meta_body: string; meta_params: number[] }>(
      "select code, meta_name, meta_category, meta_language, meta_body, meta_params from public.channel_templates order by code");
    expect(rows.map((r) => ({ code: r.code, meta_name: r.meta_name, category: r.meta_category, language: r.meta_language, body: r.meta_body, source: r.meta_params })))
      .toEqual([...META_TEMPLATES].sort((a, b) => a.code.localeCompare(b.code)).map(({ code, meta_name, category, language, body, source }) => ({ code, meta_name, category, language, body, source })));
    for (const t of META_TEMPLATES) expect(t.variables.length, t.code).toBe(t.source.length);
    // O operador aprova depois de aprovado na Meta (release/WHATSAPP.md).
    for (const code of ["verificacao_numero", "lembrete_agendamento"]) {
      const r = await rpc("worker", "channel_template_set_approval", { p_code: code, p_provider: "whatsapp_cloud", p_approved: true });
      expect(r.error).toBeNull();
    }
  });

  it("1 · conectar: sem ID ou com ID de outro número nada é gravado; com o ID certo o código vai ao WhatsApp pessoal", async () => {
    const missing = await call("channel.connect", { phone_e164: BUSINESS, verify_to_e164: OWNER_PHONE }, true);
    expect([missing.status, ErrorEnvelope.parse(missing.json).error.field]).toEqual([400, "external_account_id"]);
    const unknown = await call("channel.connect", { phone_e164: BUSINESS, external_account_id: "999000", verify_to_e164: OWNER_PHONE }, true);
    expect([unknown.status, ErrorEnvelope.parse(unknown.json).error.field]).toEqual([422, "external_account_id"]);
    const other = await call("channel.connect", { phone_e164: "+5511955550002", external_account_id: PHONE_ID, verify_to_e164: OWNER_PHONE }, true);
    expect([other.status, ErrorEnvelope.parse(other.json).error.field]).toEqual([422, "display_phone_number"]);
    expect(await sql("select 1 from public.channel_connections where tenant_id = $1 and status <> 'disconnected'", [T.B])).toHaveLength(0);

    const c = await ok(ChannelConnectionOutput, "channel.connect", { provider: "simulated", phone_e164: BUSINESS, external_account_id: PHONE_ID, verify_to_e164: OWNER_PHONE }, true);
    expect(c.connection).toMatchObject({ provider: "whatsapp_cloud", status: "pending_verification", simulated: false, external_account_id: PHONE_ID });
    expect((await ok(ChannelStatusOutput, "channel.status", {})).verification).toMatchObject({ status: "queued", send_to_e164: OWNER_PHONE });
    expect(await dispatch()).toMatchObject({ sent: 1, failed: 0 });
    const [req] = sentTo(OWNER_PHONE);
    const template = (req!.body as { template: { name: string; language: { code: string }; components: { type: string; parameters: { text: string }[] }[] } }).template;
    expect(template).toMatchObject({ name: "verificacao_numero", language: { code: "pt_BR" } });
    expect(template.components.map((x) => x.type)).toEqual(["body", "button"]);
    const code = template.components[0]!.parameters[0]!.text;
    expect(code).toMatch(/^[0-9]{6}$/);
    expect((await ok(ChannelStatusOutput, "channel.status", {})).verification?.status).toBe("sent");
    const v = await ok(ChannelConnectionOutput, "channel.verify", { code }, true);
    expect(v.connection.status).toBe("active");
  });

  it("2 · webhook assinado com o app secret entra uma vez; assinatura de outro segredo não entra", async () => {
    const msg = { contacts: [{ wa_id: ANA.slice(1), profile: { name: "Ana" } }], messages: [{ from: ANA.slice(1), id: "wamid.int.in1", timestamp: "1732190000", type: "text", text: { body: "Oi! Tem horário?" } }] };
    expect(await webhook(msg, "outro-segredo")).toMatchObject({ status: 401 });
    expect(await webhook(msg)).toEqual({ status: 200, data: { applied: 1, duplicates: 0 } });
    expect(await webhook(msg)).toEqual({ status: 200, data: { applied: 0, duplicates: 1 } });
    const inbox = await ok(InboxListOutput, "inbox.list", {});
    contactId = inbox.contacts.find((k) => k.phone_e164 === ANA)!.id;
    expect(contactId).toBeTruthy();
  });

  it("3 · texto na janela e modelo com {{1}} = negócio saem pela Graph; enviado ≠ entregue ≠ lido pelo webhook", async () => {
    const t = await ok(MessageSendOutput, "message.send", { contact_id: contactId, kind: "text", text: "Oi, Ana! Quarta às 10h?" }, true);
    const m = await ok(MessageSendOutput, "message.send", { contact_id: contactId, kind: "template", template_code: "lembrete_agendamento", template_params: ["Corte", "quarta às 10h"] }, true);
    const before = sentTo(ANA).length;
    expect(await dispatch()).toMatchObject({ sent: 2, failed: 0, retried: 0 });
    const reqs = sentTo(ANA).slice(before).map((r) => r.body as Record<string, unknown>);
    const [{ name: tenantName }] = await sql<{ name: string }>("select name from public.tenants where id = $1", [T.B]);
    expect(reqs.find((b) => b.type === "text")).toMatchObject({ text: { body: "Oi, Ana! Quarta às 10h?" } });
    expect(reqs.find((b) => b.type === "template")).toMatchObject({ template: { name: "lembrete_agendamento", components: [{ type: "body",
      parameters: [{ type: "text", text: tenantName }, { type: "text", text: "Corte" }, { type: "text", text: "quarta às 10h" }] }] } });
    const ids = await sql<{ id: string; status: string; provider_message_id: string }>("select id, status, provider_message_id from public.channel_messages where id = any ($1::uuid[]) order by created_at", [[t.message.id, m.message.id]]);
    expect(ids.map((x) => x.status)).toEqual(["sent", "sent"]);
    const pm = ids[0]!.provider_message_id;
    await webhook({ statuses: [{ id: pm, status: "delivered", timestamp: "1", recipient_id: ANA.slice(1) }] });
    let c = await ok(ConversationGetOutput, "conversation.get", { contact_id: contactId });
    expect(c.messages.find((x) => x.id === t.message.id)).toMatchObject({ status: "delivered", read_at: null });
    expect(c.messages.find((x) => x.id === m.message.id)).toMatchObject({ status: "sent", delivered_at: null });
    await webhook({ statuses: [{ id: pm, status: "read", timestamp: "2", recipient_id: ANA.slice(1) }, { id: pm, status: "delivered", timestamp: "1", recipient_id: ANA.slice(1) }] });
    c = await ok(ConversationGetOutput, "conversation.get", { contact_id: contactId });
    expect(c.messages.find((x) => x.id === t.message.id)?.status).toBe("read");
  });

  it("4 · 429 da Graph: a mensagem volta à fila com espera (a conversa mostra); nada é reenviado na mesma rodada", async () => {
    const m = await ok(MessageSendOutput, "message.send", { contact_id: contactId, kind: "text", text: "Mensagem que bate no limite" }, true);
    graph.queue.push({ kind: "rate_limited", retryAfter: 120 });
    expect(await dispatch()).toMatchObject({ sent: 0, retried: 1 });
    const c = await ok(ConversationGetOutput, "conversation.get", { contact_id: contactId });
    const msg = c.messages.find((x) => x.id === m.message.id)!;
    expect(msg).toMatchObject({ status: "queued", retry_reason: "throughput_limit" });
    expect(Date.parse(msg.next_attempt_at!)).toBeGreaterThan(Date.now() + 100_000);
    expect(await dispatch()).toMatchObject({ sent: 0, retried: 0 });
  });

  it("5 · SAIR da cliente: o que estava na fila falha com motivo e nada mais vai para a Graph", async () => {
    const m = await ok(MessageSendOutput, "message.send", { contact_id: contactId, kind: "text", text: "Outra mensagem" }, true);
    expect(await webhook({ messages: [{ from: ANA.slice(1), id: "wamid.int.sair", timestamp: "3", type: "button", button: { text: "SAIR", payload: "SAIR" } }] })).toMatchObject({ status: 200 });
    const rows = await sql<{ id: string; status: string; failure_reason: string }>("select id, status, failure_reason from public.channel_messages where contact_id = $1 and direction = 'outbound' and status in ('queued', 'failed') order by created_at", [contactId]);
    expect(rows.every((r) => r.status === "failed" && r.failure_reason === "opted_out")).toBe(true);
    expect(rows.map((r) => r.id)).toContain(m.message.id);
    await sql("update public.channel_messages set next_attempt_at = now() - interval '1 second' where contact_id = $1 and status = 'queued'", [contactId]);
    const before = sentTo(ANA).length;
    await dispatch();
    expect(sentTo(ANA).length).toBe(before);
    const fails = await call("message.send", { contact_id: contactId, kind: "text", text: "e agora?" }, true);
    expect(ErrorEnvelope.parse(fails.json).error).toMatchObject({ code: "POLICY_REJECTED", field: "opted_out" });
  });
});
