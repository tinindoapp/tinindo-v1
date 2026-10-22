// P12 pelos handlers com o banco real e o provedor simulado: conectar e verificar o número pelo código que o
// próprio canal entregou; a cliente escreve (webhook assinado pelo caminho de sim.inbound); o dono responde na
// janela; despacho; entregue/lido pelo webhook; modelo aprovado; número inválido falha; 9999 fica desconhecido e a
// consulta resolve; humano assume; opt-out da cliente; desconectar falha a fila. SEC: outro dono e sem assinatura.
import { afterAll, describe, expect, it } from "vitest";
import { ChannelConnectionOutput, ChannelStatusOutput, ContactOutput, ConversationGetOutput, InboxListOutput, MessageSendOutput, SimInboundOutput, SimPhoneOutput } from "@contracts";
import { call, fails, FX, handlers, ok, pool, runDispatch, sql, T, U } from "./harness.ts";

const owner = { as: U.ownerA, tenant: T.A };
const BUSINESS = "+5511999990001";
const ANA = "+5511988887777";
const BAD = "+5511988880000";
const SLOW = "+5511988889999";
afterAll(() => pool.end());

const inbound = (phone_e164: string, text: string, key: string | true = true) =>
  ok(SimInboundOutput, "messaging", "sim.inbound", { ...owner, key, body: { kind: "inbound", phone_e164, text } });
/** Leitura direta com a sessão do dono A (como o supabase-js faria): devolve `n` ou a mensagem do erro. */
async function asOwnerA(text: string): Promise<number | string> {
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: U.ownerA, role: "authenticated" })]);
    await c.query("set local role authenticated");
    try {
      return (await c.query<{ n: number }>(text)).rows[0]!.n;
    } catch (e) {
      return (e as Error).message;
    }
  } finally {
    await c.query("rollback").catch(() => undefined);
    c.release();
  }
}
const convo = (contact_id: string) => ok(ConversationGetOutput, "messaging", "conversation.get", { ...owner, body: { contact_id } });

describe("P12 · canal simulado de ponta a ponta", () => {
  let contactId = "";
  let sentId = "";

  it("1 · conectar: o código chega pelo canal ao telefone simulado do negócio e verifica o número", async () => {
    await sql("update public.customers set phone = $1 where id = $2", [ANA, FX.customers.abInA]);
    const c = await ok(ChannelConnectionOutput, "messaging", "channel.connect", { ...owner, key: true, body: { provider: "simulated", phone_e164: BUSINESS } });
    expect(c.connection).toMatchObject({ status: "pending_verification", simulated: true, verified_at: null });
    // Segunda conexão enquanto há uma pendente: recusada.
    await fails("messaging", "channel.connect", { ...owner, key: true, body: { provider: "simulated", phone_e164: "+5511999990002" } }, "POLICY_REJECTED", "connection");
    // Antes do despacho, nada no telefone; o código nunca aparece na resposta da API.
    expect((await ok(SimPhoneOutput, "messaging", "sim.phone", { ...owner, body: { phone_e164: BUSINESS } })).messages).toEqual([]);
    expect(await runDispatch()).toMatchObject({ sent: 1, failed: 0, unknown: 0 });
    const phone = await ok(SimPhoneOutput, "messaging", "sim.phone", { ...owner, body: { phone_e164: BUSINESS } });
    const code = /\b([0-9]{6})\b/.exec(phone.messages[0]!.body)?.[1];
    expect(code).toBeDefined();
    const wrong = code === "000000" ? "111111" : "000000";
    await fails("messaging", "channel.verify", { ...owner, key: true, body: { code: wrong } }, "POLICY_REJECTED", "code");
    const [{ attempts }] = await sql<{ attempts: number }>("select attempts from public.channel_verifications order by created_at desc limit 1");
    expect(attempts).toBe(1); // a tentativa errada ficou gravada
    const v = await ok(ChannelConnectionOutput, "messaging", "channel.verify", { ...owner, key: true, body: { code: code! } });
    expect(v.connection.status).toBe("active");
    const st = await ok(ChannelStatusOutput, "messaging", "channel.status", { ...owner, body: {} });
    expect(st.connection?.status).toBe("active");
    expect(st.templates.find((t) => t.code === "confirmacao_agendamento")?.approved).toBe(true);
  });

  it("2 · a cliente escreve: contato nasce vinculado pelo telefone, janela abre, repetir o evento é duplicado", async () => {
    const r = await inbound(ANA, "Oi! Quero marcar um corte.", "evt-ana-0001-primeira-mensagem");
    expect(r).toEqual({ applied: 1, duplicates: 0 });
    expect(await inbound(ANA, "Oi! Quero marcar um corte.", "evt-ana-0001-primeira-mensagem")).toEqual({ applied: 0, duplicates: 1 });
    const inbox = await ok(InboxListOutput, "messaging", "inbox.list", { ...owner, body: {} });
    const ana = inbox.contacts.find((k) => k.phone_e164 === ANA)!;
    expect(ana).toMatchObject({ customer_id: FX.customers.abInA, window_open: true, unread_count: 1, handling: "assistant", opted_out: false, opt_in_source: "inbound" });
    expect(ana.last_message?.direction).toBe("inbound");
    contactId = ana.id;
    const ev = await sql<{ n: number }>("select count(*)::int as n from public.outbox_events where event_type = 'channel.message.received.v1' and tenant_id = $1", [T.A]);
    expect(ev[0]!.n).toBe(1);
  });

  it("3 · o dono responde texto na janela; o despacho envia; o webhook marca entregue e lido, nunca para trás", async () => {
    const m = await ok(MessageSendOutput, "messaging", "message.send", { ...owner, key: true, body: { contact_id: contactId, kind: "text", text: "Oi, Ana! Tenho quarta às 10h." } });
    expect(m.message.status).toBe("queued");
    sentId = m.message.id;
    expect(await runDispatch()).toMatchObject({ sent: 1, failed: 0, unknown: 0 });
    const phone = await ok(SimPhoneOutput, "messaging", "sim.phone", { ...owner, body: { phone_e164: ANA } });
    expect(phone.messages.at(-1)?.body).toBe("Oi, Ana! Tenho quarta às 10h.");
    const pmid = phone.messages.at(-1)!.provider_message_id!;
    let c = await convo(contactId);
    expect(c.messages.find((x) => x.id === sentId)).toMatchObject({ status: "sent", direction: "outbound" });
    expect(c.messages.map((x) => x.direction)).toEqual(["inbound", "outbound"]);
    await ok(SimInboundOutput, "messaging", "sim.inbound", { ...owner, key: true, body: { kind: "status", provider_message_id: pmid, status: "read" } });
    c = await convo(contactId);
    expect(c.messages.find((x) => x.id === sentId)).toMatchObject({ status: "read" });
    expect(c.messages.find((x) => x.id === sentId)?.delivered_at).not.toBeNull();
    // Entregue depois de lido: ignorado (só avança).
    expect(await ok(SimInboundOutput, "messaging", "sim.inbound", { ...owner, key: true, body: { kind: "status", provider_message_id: pmid, status: "delivered" } })).toEqual({ applied: 0, duplicates: 0 });
    expect((await convo(contactId)).messages.find((x) => x.id === sentId)?.status).toBe("read");
  });

  it("4 · fora da janela só modelo aprovado com opt-in; modelo inexistente e parâmetros errados são recusados", async () => {
    await sql("update public.channel_contacts set last_inbound_at = clock_timestamp() - interval '25 hours' where id = $1", [contactId]);
    await fails("messaging", "message.send", { ...owner, key: true, body: { contact_id: contactId, kind: "text", text: "ainda aí?" } }, "POLICY_REJECTED", "window");
    await fails("messaging", "message.send", { ...owner, key: true, body: { contact_id: contactId, kind: "template", template_code: "promo_inexistente", template_params: [] } }, "POLICY_REJECTED", "template_code");
    await fails("messaging", "message.send", { ...owner, key: true, body: { contact_id: contactId, kind: "template", template_code: "lembrete_agendamento", template_params: ["só um"] } }, "VALIDATION_ERROR", "template_params");
    const t = await ok(MessageSendOutput, "messaging", "message.send", { ...owner, key: true, body: { contact_id: contactId, kind: "template", template_code: "lembrete_agendamento", template_params: ["Corte", "quarta às 10h"] } });
    expect(t.message).toMatchObject({ kind: "template", template_code: "lembrete_agendamento", body: "Lembrete: Corte em quarta às 10h. Se precisar remarcar, responda esta mensagem." });
    expect(await runDispatch()).toMatchObject({ sent: 1 });
  });

  it("5 · número inválido falha com motivo e evento; 9999 fica desconhecido, sem reenvio, e a consulta resolve", async () => {
    await inbound(BAD, "oi");
    await inbound(SLOW, "oi");
    const inbox = await ok(InboxListOutput, "messaging", "inbox.list", { ...owner, body: {} });
    const bad = inbox.contacts.find((k) => k.phone_e164 === BAD)!.id;
    const slow = inbox.contacts.find((k) => k.phone_e164 === SLOW)!.id;
    const mb = await ok(MessageSendOutput, "messaging", "message.send", { ...owner, key: true, body: { contact_id: bad, kind: "text", text: "x" } });
    const ms = await ok(MessageSendOutput, "messaging", "message.send", { ...owner, key: true, body: { contact_id: slow, kind: "text", text: "y" } });
    expect(await runDispatch()).toMatchObject({ sent: 0, failed: 1, unknown: 1, reconciled: 0 });
    expect((await convo(bad)).messages.find((x) => x.id === mb.message.id)).toMatchObject({ status: "failed", failure_reason: "invalid_number" });
    expect((await convo(slow)).messages.find((x) => x.id === ms.message.id)).toMatchObject({ status: "delivery_unknown" });
    expect((await ok(ChannelStatusOutput, "messaging", "channel.status", { ...owner, body: {} })).unknown).toBe(1);
    const ev = await sql<{ n: number }>("select count(*)::int as n from public.outbox_events where event_type = 'channel.message.failed.v1'");
    expect(ev[0]!.n).toBe(1);
    // Nova rodada: nada é reenviado (a mensagem não volta à fila); só depois de 1 min a consulta de status resolve.
    expect(await runDispatch()).toMatchObject({ sent: 0, failed: 0, unknown: 0, reconciled: 0 });
    await sql("update public.channel_messages set unknown_since = clock_timestamp() - interval '2 minutes' where id = $1", [ms.message.id]);
    expect(await runDispatch()).toMatchObject({ reconciled: 1 });
    expect((await convo(slow)).messages.find((x) => x.id === ms.message.id)?.status).toBe("sent");
    const [{ attempts }] = await sql<{ attempts: number }>("select attempts from public.channel_messages where id = $1", [ms.message.id]);
    expect(attempts).toBe(1);
  });

  it("6 · humano assume, vínculo com cliente, opt-out pela própria cliente bloqueia envio; opt-in declarado reabre", async () => {
    const h = await ok(ContactOutput, "messaging", "conversation.handoff", { ...owner, key: true, body: { contact_id: contactId, handling: "human" } });
    expect(h.contact.handling).toBe("human");
    await fails("messaging", "contact.link", { ...owner, key: true, body: { contact_id: contactId, customer_id: FX.customers.abInB } }, "NOT_FOUND", "customer_id");
    expect((await ok(ContactOutput, "messaging", "contact.link", { ...owner, key: true, body: { contact_id: contactId, customer_id: null } })).contact.customer_id).toBeNull();
    expect((await ok(ContactOutput, "messaging", "contact.link", { ...owner, key: true, body: { contact_id: contactId, customer_id: FX.customers.abInA } })).contact.customer_id).toBe(FX.customers.abInA);
    await inbound(ANA, "sair");
    expect((await convo(contactId)).contact).toMatchObject({ opted_out: true, window_open: true });
    await fails("messaging", "message.send", { ...owner, key: true, body: { contact_id: contactId, kind: "text", text: "tudo bem" } }, "POLICY_REJECTED", "opted_out");
    expect((await ok(ContactOutput, "messaging", "contact.consent", { ...owner, key: true, body: { contact_id: contactId, opted_in: true } })).contact.opted_out).toBe(false);
    await ok(MessageSendOutput, "messaging", "message.send", { ...owner, key: true, body: { contact_id: contactId, kind: "text", text: "Combinado!" } });
  });

  it("SEC · outro dono não vê nem escreve; webhook sem assinatura válida não entra; sem conexão não há simulador", async () => {
    const other = { as: U.ownerB, tenant: T.A };
    await fails("messaging", "inbox.list", { ...other, body: {} }, "FORBIDDEN");
    await fails("messaging", "conversation.get", { ...other, body: { contact_id: contactId } }, "FORBIDDEN");
    await fails("messaging", "message.send", { ...other, key: true, body: { contact_id: contactId, kind: "text", text: "oi" } }, "FORBIDDEN");
    await fails("messaging", "sim.inbound", { ...other, key: true, body: { kind: "inbound", phone_e164: ANA, text: "oi" } }, "FORBIDDEN");
    const raw = JSON.stringify({ events: [{ external_event_id: "forjado-1", kind: "inbound", external_account_id: BUSINESS, phone_e164: ANA, text: "forjado" }] });
    const res = await handlers.messaging!(new Request("http://edge/functions/v1/messaging/channel.webhook/simulated", { method: "POST", body: raw, headers: { "X-Hub-Signature-256": "sha256=" + "0".repeat(64) } }));
    expect(res.status).toBe(401);
    expect((await sql<{ n: number }>("select count(*)::int as n from public.channel_webhook_events where external_event_id = 'forjado-1'"))[0]!.n).toBe(0);
    // O dono não lê as tabelas de backend pela Data API: sem grant nem política.
    expect(await asOwnerA("select count(*)::int as n from public.channel_verifications")).toMatch(/permission denied/);
    expect(await asOwnerA("select count(*)::int as n from public.channel_sim_phone")).toMatch(/permission denied/);
    expect(await asOwnerA("select count(*)::int as n from public.channel_webhook_events")).toMatch(/permission denied/);
    expect(await asOwnerA("select count(*)::int as n from public.channel_messages")).toBeGreaterThan(0);
  });

  it("7 · desconectar: fila pendente falha com motivo; depois o simulador e o envio ficam indisponíveis", async () => {
    const d = await ok(ChannelConnectionOutput, "messaging", "channel.disconnect", { ...owner, key: true, body: {} });
    expect(d.connection.status).toBe("disconnected");
    const last = (await convo(contactId)).messages.at(-1)!;
    expect(last).toMatchObject({ body: "Combinado!", status: "failed", failure_reason: "disconnected" });
    await fails("messaging", "sim.phone", { ...owner, body: { phone_e164: ANA } }, "POLICY_REJECTED", "provider");
    await fails("messaging", "message.send", { ...owner, key: true, body: { contact_id: contactId, kind: "text", text: "oi" } }, "POLICY_REJECTED", "connection");
    expect((await ok(ChannelStatusOutput, "messaging", "channel.status", { ...owner, body: {} })).connection).toBeNull();
    expect(await runDispatch()).toMatchObject({ sent: 0, failed: 0, unknown: 0 });
    const r = await call("messaging", "sim.inbound", { ...owner, key: true, body: { kind: "inbound", phone_e164: ANA, text: "oi" } });
    expect(r.error?.code).toBe("POLICY_REJECTED");
  });
});
