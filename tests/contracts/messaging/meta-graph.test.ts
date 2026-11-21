// Bloco 2 · adaptador da Meta (Cloud API) contra um SERVIDOR FALSO que imita a Graph (sem rede): envio aceito, erro
// 4xx com código, 429, código de limite, 5xx, tempo esgotado e leitura do número; webhook assinado como a Meta assina,
// assinatura inválida e repetição do mesmo webhook pela função `messaging`. O teste com a Meta de verdade é
// meta-live.test.ts (fora do CI, só com WHATSAPP_LIVE=1).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { OutboundItem } from "../../../supabase/functions/_shared/domain/messaging/port.ts";
import { createWhatsAppProvider } from "../../../supabase/functions/_shared/providers/meta.ts";
import { messagingChoice } from "../../../supabase/functions/_shared/providers/selection.ts";
import { createMessagingHandler, DISPATCH_SECRET_HEADER, SIGNATURE_HEADER } from "../../../supabase/functions/messaging/handler.ts";
import { type FakeGraph, metaDelivery, startFakeGraph, webhookBody } from "./fake-graph.ts";

const APP_SECRET = "app-secret-falso-de-teste";
const PHONE_ID = "1029384756";
const DISPATCH = "segredo-do-despacho-com-mais-de-32-caracteres";
let graph: FakeGraph;
beforeAll(async () => {
  graph = await startFakeGraph();
  graph.numbers.set(PHONE_ID, "+55 11 99999-0001");
});
afterAll(() => graph.close());

const meta = () => createWhatsAppProvider({ accessToken: "token-falso", appSecret: APP_SECRET, graphUrl: graph.graphUrl, timeoutMs: 300, lookupTimeoutMs: 300 });
const item = (over: Partial<OutboundItem> = {}): OutboundItem => ({ ref: "msg:1", provider: "whatsapp_cloud", external_account_id: PHONE_ID, to: "+5511988887777",
  body: "Lembrete de Barbearia Exemplo: Corte em amanhã às 10h. Se precisar remarcar, responda esta mensagem.", kind: "template",
  template_code: "lembrete_agendamento", template_params: ["Corte", "amanhã às 10h"],
  provider_template: { name: "lembrete_agendamento", language: "pt_BR", category: "utility", params: ["Barbearia Exemplo", "Corte", "amanhã às 10h"] }, ...over });

describe("Meta · envio contra a Graph falsa", () => {
  it("sucesso: modelo com {{1}} = negócio e os demais na ordem; a Graph recebe token, nome, idioma e parâmetros", async () => {
    const out = await meta().send(item());
    expect(out).toMatchObject({ outcome: "sent", provider_message_id: expect.stringMatching(/^wamid\.falso\./) });
    const req = graph.requests.at(-1)!;
    expect(req.path).toBe(`/v21.0/${PHONE_ID}/messages`);
    expect(req.headers.authorization).toBe("Bearer token-falso");
    expect(req.body).toEqual({ messaging_product: "whatsapp", recipient_type: "individual", to: "5511988887777", type: "template",
      template: { name: "lembrete_agendamento", language: { code: "pt_BR" }, components: [{ type: "body", parameters: [
        { type: "text", text: "Barbearia Exemplo" }, { type: "text", text: "Corte" }, { type: "text", text: "amanhã às 10h" }] }] } });
  });

  it("texto livre dentro da janela vai como texto", async () => {
    expect(await meta().send(item({ kind: "text", body: "Oi, Ana!", template_code: null, template_params: null, provider_template: null }))).toMatchObject({ outcome: "sent" });
    expect(graph.requests.at(-1)!.body).toMatchObject({ type: "text", text: { body: "Oi, Ana!" } });
  });

  it("erro 4xx com código: falha final com o motivo (janela fechada) ou com o código", async () => {
    graph.queue.push({ kind: "error", status: 400, code: 131047, message: "Re-engagement message" }, { kind: "error", status: 400, code: 132001 }, { kind: "error", status: 400, code: 135000 });
    expect(await meta().send(item())).toEqual({ outcome: "failed", reason: "window_closed" });
    expect(await meta().send(item())).toEqual({ outcome: "failed", reason: "template_not_found" });
    expect(await meta().send(item())).toEqual({ outcome: "failed", reason: "graph_400_135000" });
  });

  it("token errado: falha com token_invalid (não é limite, não volta para a fila)", async () => {
    const wrong = createWhatsAppProvider({ accessToken: "outro", appSecret: APP_SECRET, graphUrl: graph.graphUrl, timeoutMs: 300 });
    expect(await wrong.send(item())).toEqual({ outcome: "failed", reason: "token_invalid" });
  });

  it("429 e código de limite: retentativa pela fila, com a espera que a Graph pediu", async () => {
    graph.queue.push({ kind: "rate_limited", retryAfter: 20 }, { kind: "error", status: 400, code: 130429 }, { kind: "error", status: 400, code: 131056 }, { kind: "error", status: 400, code: 80007 });
    expect(await meta().send(item())).toEqual({ outcome: "retry", reason: "throughput_limit", scope: "number", retry_after_s: 20 });
    expect(await meta().send(item())).toMatchObject({ outcome: "retry", reason: "throughput_limit", scope: "number" });
    expect(await meta().send(item())).toMatchObject({ outcome: "retry", reason: "pair_rate_limit", scope: "pair" });
    expect(await meta().send(item())).toMatchObject({ outcome: "retry", reason: "account_rate_limit", scope: "account" });
  });

  it("5xx e tempo esgotado: desconhecido, sem reenvio (a mensagem pode ter saído)", async () => {
    graph.queue.push({ kind: "server_error" }, { kind: "timeout", ms: 2_000 });
    const before = graph.requests.length;
    expect(await meta().send(item())).toEqual({ outcome: "delivery_unknown" });
    expect(await meta().send(item())).toEqual({ outcome: "delivery_unknown" });
    expect(graph.requests.length - before).toBe(2);
  });

  it("leitura do número: só o que a Graph informa; id desconhecido = não reconhecido", async () => {
    expect(await meta().lookup!(PHONE_ID)).toEqual({ outcome: "found", display_phone_number: "+55 11 99999-0001", verified_name: "Negócio de teste", quality_rating: "GREEN" });
    expect(graph.requests.at(-1)!.path).toBe(`/v21.0/${PHONE_ID}?fields=display_phone_number,verified_name,quality_rating`);
    expect(await meta().lookup!("999999")).toEqual({ outcome: "not_found", reason: "graph_400_100" });
  });
});

describe("Meta · webhook e despacho pela função `messaging`", () => {
  /** Ingestão em memória com a mesma chave de dedupe do banco: (provider, external_event_id). */
  function setup() {
    const seen = new Set<string>();
    const ingested: unknown[] = [];
    const results: Record<string, unknown>[] = [];
    let claim: OutboundItem[] = [];
    const serviceRpc = async (fn: string, args: Record<string, unknown>) => {
      if (fn === "channel_webhook_ingest") {
        let applied = 0;
        let duplicates = 0;
        for (const e of args.p_events as { external_event_id: string }[]) {
          const k = `${String(args.p_provider)}|${e.external_event_id}`;
          if (seen.has(k)) duplicates++;
          else { seen.add(k); applied++; ingested.push(e); }
        }
        return { data: { applied, duplicates }, error: null };
      }
      if (fn === "channel_dispatch_claim") {
        const items = claim;
        claim = [];
        return { data: { items }, error: null };
      }
      if (fn === "channel_dispatch_result") results.push(args);
      return { data: { items: [] }, error: null };
    };
    const choice = messagingChoice((k) => ({ MESSAGING_PROVIDER: "meta", WHATSAPP_ACCESS_TOKEN: "token-falso", WHATSAPP_APP_SECRET: APP_SECRET, WHATSAPP_VERIFY_TOKEN: "verifica" } as Record<string, string>)[k]);
    const handler = createMessagingHandler({ allowedOrigins: [], dispatchSecret: DISPATCH, simulatedSecret: "segredo-do-simulador-0000000001", verifyToken: "verifica",
      providers: { whatsapp_cloud: meta() }, choice, serviceRpc, rpc: async () => ({ data: null, error: null }) });
    return { handler, ingested, results, setClaim: (items: OutboundItem[]) => (claim = items) };
  }
  const post = (handler: (r: Request) => Promise<Response>, raw: string, signature: string | null) =>
    handler(new Request("http://edge/functions/v1/messaging/channel.webhook/whatsapp_cloud", {
      method: "POST", body: raw, headers: { "Content-Type": "application/json", ...(signature ? { [SIGNATURE_HEADER]: signature } : {}) } }));

  it("assinatura válida entra; assinatura inválida, ausente ou de corpo alterado = 401 e nada é lido", async () => {
    const { handler, ingested } = setup();
    const d = metaDelivery(webhookBody(PHONE_ID, { contacts: [{ wa_id: "5511988887777", profile: { name: "Ana" } }],
      messages: [{ from: "5511988887777", id: "wamid.entrada.1", timestamp: "1732190000", type: "text", text: { body: "Oi, tem horário?" } }] }), APP_SECRET);
    expect((await post(handler, d.raw, d.signature)).status).toBe(200);
    expect(ingested).toEqual([expect.objectContaining({ external_event_id: "msg:wamid.entrada.1", phone_e164: "+5511988887777", text: "Oi, tem horário?" })]);
    const forged = metaDelivery(JSON.parse(d.raw), "outro-segredo");
    expect((await post(handler, d.raw, forged.signature)).status).toBe(401);
    expect((await post(handler, d.raw, null)).status).toBe(401);
    expect((await post(handler, d.raw.replace("horário", "horario"), d.signature)).status).toBe(401);
    expect(ingested).toHaveLength(1);
  });

  it("repetição do mesmo webhook (a Meta reentrega): duplicado, nada aplicado de novo", async () => {
    const { handler, ingested } = setup();
    const d = metaDelivery(webhookBody(PHONE_ID, { statuses: [
      { id: "wamid.saida.1", status: "sent", timestamp: "1732190001", recipient_id: "5511988887777" },
      { id: "wamid.saida.1", status: "delivered", timestamp: "1732190002", recipient_id: "5511988887777" }] }), APP_SECRET);
    const first = await (await post(handler, d.raw, d.signature)).json() as { data: unknown };
    const again = await (await post(handler, d.raw, d.signature)).json() as { data: unknown };
    expect(first.data).toEqual({ applied: 2, duplicates: 0 });
    expect(again.data).toEqual({ applied: 0, duplicates: 2 });
    expect(ingested.map((e) => (e as { external_event_id: string }).external_event_id)).toEqual(["st:wamid.saida.1:sent", "st:wamid.saida.1:delivered"]);
  });

  it("desafio GET da Meta: só com o token de verificação certo", async () => {
    const { handler } = setup();
    const url = (t: string) => `http://edge/functions/v1/messaging/channel.webhook/whatsapp_cloud?hub.mode=subscribe&hub.verify_token=${t}&hub.challenge=987`;
    const okRes = await handler(new Request(url("verifica")));
    expect([okRes.status, await okRes.text()]).toEqual([200, "987"]);
    expect((await handler(new Request(url("errado")))).status).toBe(403);
  });

  it("despacho com 429 da Graph: o item volta à fila com espera; o seguinte do mesmo número nem chama a Graph", async () => {
    const { handler, results, setClaim } = setup();
    graph.queue.push({ kind: "rate_limited", retryAfter: 5 });
    setClaim([item({ ref: "msg:a" }), item({ ref: "msg:b", to: "+5511977776666" })]);
    const before = graph.requests.length;
    const res = await handler(new Request("http://edge/functions/v1/messaging/channel.dispatch", { method: "POST", headers: { [DISPATCH_SECRET_HEADER]: DISPATCH } }));
    expect((await res.json() as { data: unknown }).data).toMatchObject({ sent: 0, retried: 2 });
    expect(graph.requests.length - before).toBe(1);
    expect(results.map((r) => [r.p_ref, r.p_outcome, r.p_retry_after_s])).toEqual([["msg:a", "retry", 5], ["msg:b", "requeue", null]]);
  });
});
