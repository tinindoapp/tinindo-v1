// Adaptador da Meta (Cloud API) com fetch falso: corpo do envio, classificação das respostas, webhook e leitura do
// número. O servidor HTTP falso que imita a Graph fica em tests/contracts/messaging/meta-graph.test.ts.
import { describe, expect, it, vi } from "vitest";
import type { OutboundItem } from "../domain/messaging/port.ts";
import { hmacSha256Hex } from "../domain/messaging/port.ts";
import { buildPayload, cleanParam, createWhatsAppProvider, graphReason } from "./meta.ts";

const text: OutboundItem = { ref: "msg:1", provider: "whatsapp_cloud", external_account_id: "1234567890", to: "+5511988887777", body: "Olá", kind: "text", template_code: null, template_params: null };
const tpl: OutboundItem = { ...text, kind: "template", body: "Lembrete de Barbearia: Corte em amanhã.", template_code: "lembrete_agendamento", template_params: ["Corte", "amanhã"],
  provider_template: { name: "lembrete_agendamento", language: "pt_BR", category: "utility", params: ["Barbearia", "Corte", "amanhã"] } };
const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

describe("Meta · corpo do envio", () => {
  it("texto livre: só o texto, sem prévia de link, número sem +", () => {
    expect(buildPayload(text)).toEqual({ payload: { messaging_product: "whatsapp", recipient_type: "individual", to: "5511988887777", type: "text", text: { preview_url: false, body: "Olá" } } });
  });
  it("modelo: nome, pt_BR e parâmetros na ordem da Meta ({{1}} = negócio); o texto guardado não vai", () => {
    const p = buildPayload(tpl);
    expect(p).toEqual({ payload: { messaging_product: "whatsapp", recipient_type: "individual", to: "5511988887777", type: "template",
      template: { name: "lembrete_agendamento", language: { code: "pt_BR" }, components: [{ type: "body", parameters: [
        { type: "text", text: "Barbearia" }, { type: "text", text: "Corte" }, { type: "text", text: "amanhã" }] }] } } });
    expect(JSON.stringify(p)).not.toContain("Lembrete de");
  });
  it("autenticação: o código vai no corpo e no botão de copiar código", () => {
    const p = buildPayload({ ...tpl, template_code: "verificacao_numero", provider_template: { name: "verificacao_numero", language: "pt_BR", category: "authentication", params: ["123456"] } });
    expect(p).toMatchObject({ payload: { template: { components: [
      { type: "body", parameters: [{ type: "text", text: "123456" }] },
      { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: "123456" }] }] } } });
  });
  it("modelo sem cadastro na Meta ou com campo vazio não sai", () => {
    expect(buildPayload({ ...tpl, provider_template: null })).toEqual({ reason: "template_not_mapped" });
    expect(buildPayload({ ...tpl, provider_template: { ...tpl.provider_template!, params: ["Barbearia", " \n ", "x"] } })).toEqual({ reason: "template_param_empty" });
  });
  it("parâmetro sem quebra de linha, tabulação nem 4+ espaços seguidos", () => {
    expect(cleanParam("Corte\ne\tbarba     já")).toBe("Corte e barba   já");
  });
});

describe("Meta · resposta da Graph", () => {
  const send = async (res: Response | Error) => {
    const fetchMock = vi.fn(async () => { if (res instanceof Error) throw res; return res; });
    const p = createWhatsAppProvider({ accessToken: "tok", appSecret: "s", graphUrl: "https://graph.test/v21.0", fetch: fetchMock as typeof fetch });
    return { out: await p.send(tpl), fetchMock };
  };
  it("200 com id = enviado; vai para /{phone_number_id}/messages com o token no header", async () => {
    const { out, fetchMock } = await send(json(200, { messaging_product: "whatsapp", messages: [{ id: "wamid.ok" }] }));
    expect(out).toEqual({ outcome: "sent", provider_message_id: "wamid.ok" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://graph.test/v21.0/1234567890/messages");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
  });
  it("200 sem id = desconhecido (não finge enviado)", async () => {
    expect((await send(json(200, {}))).out).toEqual({ outcome: "delivery_unknown" });
  });
  it("5xx e tempo esgotado = desconhecido, sem reenvio", async () => {
    expect((await send(json(503, { error: { code: 130429 } }))).out).toEqual({ outcome: "delivery_unknown" });
    expect((await send(Object.assign(new Error("timeout"), { name: "TimeoutError" }))).out).toEqual({ outcome: "delivery_unknown" });
  });
  it("429 e códigos de limite = retentativa pela fila, com o alcance do limite", async () => {
    expect((await send(json(429, {}, { "retry-after": "30" }))).out).toEqual({ outcome: "retry", reason: "rate_limited", scope: "number", retry_after_s: 30 });
    expect((await send(json(400, { error: { code: 130429 } }))).out).toMatchObject({ outcome: "retry", reason: "throughput_limit", scope: "number" });
    expect((await send(json(400, { error: { code: 131056 } }))).out).toMatchObject({ outcome: "retry", reason: "pair_rate_limit", scope: "pair" });
    expect((await send(json(400, { error: { code: 80007 } }))).out).toMatchObject({ outcome: "retry", reason: "account_rate_limit", scope: "account" });
    expect((await send(json(400, { error: { code: 4 } }))).out).toMatchObject({ outcome: "retry", reason: "app_rate_limit", scope: "account" });
  });
  it("outros 4xx = falha final com motivo legível ou com o código", async () => {
    expect((await send(json(400, { error: { code: 131047 } }))).out).toEqual({ outcome: "failed", reason: "window_closed" });
    expect((await send(json(401, { error: { code: 190 } }))).out).toEqual({ outcome: "failed", reason: "token_invalid" });
    expect((await send(json(400, { error: { code: 131000 } }))).out).toEqual({ outcome: "failed", reason: "graph_400_131000" });
    expect((await send(json(404, "não é json"))).out).toEqual({ outcome: "failed", reason: "graph_404" });
    expect(graphReason(null, 131026)).toBe("undeliverable");
  });
  it("sem token e app secret: não configurado e nada vai à rede", async () => {
    const fetchMock = vi.fn();
    const off = createWhatsAppProvider({ accessToken: null, appSecret: null, fetch: fetchMock });
    expect(off.configured).toBe(false);
    expect(await off.send(text)).toEqual({ outcome: "failed", reason: "provider_not_configured" });
    expect(await off.lookup!("123456")).toEqual({ outcome: "unavailable" });
    expect(await off.verifySignature("{}", "sha256=" + "0".repeat(64))).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("Meta · leitura do número", () => {
  const lookup = async (res: Response | Error) => {
    const fetchMock = vi.fn(async () => { if (res instanceof Error) throw res; return res; });
    const p = createWhatsAppProvider({ accessToken: "tok", appSecret: "s", graphUrl: "https://graph.test/v21.0", fetch: fetchMock as typeof fetch });
    return { out: await p.lookup!("1234567890"), fetchMock };
  };
  it("só os campos que a Graph informa", async () => {
    const { out, fetchMock } = await lookup(json(200, { display_phone_number: "+55 11 99999-0001", verified_name: "Barbearia", quality_rating: "GREEN", id: "1234567890" }));
    expect(out).toEqual({ outcome: "found", display_phone_number: "+55 11 99999-0001", verified_name: "Barbearia", quality_rating: "GREEN" });
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe("https://graph.test/v21.0/1234567890?fields=display_phone_number,verified_name,quality_rating");
  });
  it("4xx = não reconhecido; 5xx, 429 e rede = indisponível", async () => {
    expect((await lookup(json(400, { error: { code: 100 } }))).out).toEqual({ outcome: "not_found", reason: "graph_400_100" });
    expect((await lookup(json(500, {}))).out).toEqual({ outcome: "unavailable" });
    expect((await lookup(json(429, {}))).out).toEqual({ outcome: "unavailable" });
    expect((await lookup(new Error("rede"))).out).toEqual({ outcome: "unavailable" });
    expect((await lookup(json(200, { id: "1" }))).out).toEqual({ outcome: "not_found", reason: "no_display_phone_number" });
  });
});

describe("Meta · webhook", () => {
  const wa = createWhatsAppProvider({ accessToken: "tok", appSecret: "app-secret", fetch: vi.fn() });
  const body = (value: Record<string, unknown>, object = "whatsapp_business_account") => ({ object, entry: [{ id: "WABA", changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { phone_number_id: "123", display_phone_number: "5511999990001" }, ...value } }] }] });

  it("texto, botão e resposta interativa viram mensagem; mídia é ignorada; id do evento estável", () => {
    const events = wa.normalize(body({
      contacts: [{ wa_id: "5511988887777", profile: { name: "Ana" } }],
      messages: [
        { id: "wamid.1", from: "5511988887777", type: "text", text: { body: "oi" } },
        { id: "wamid.2", from: "5511988887777", type: "image", image: { id: "x" } },
        { id: "wamid.3", from: "5511988887777", type: "button", button: { text: "SAIR", payload: "SAIR" } },
        { id: "wamid.4", from: "5511988887777", type: "interactive", interactive: { type: "button_reply", button_reply: { id: "b", title: "Confirmar" } } },
      ],
    }));
    expect(events.map((e) => [e.external_event_id, e.text])).toEqual([["msg:wamid.1", "oi"], ["msg:wamid.3", "SAIR"], ["msg:wamid.4", "Confirmar"]]);
    expect(events[0]).toMatchObject({ kind: "inbound", external_account_id: "123", phone_e164: "+5511988887777", profile_name: "Ana" });
  });
  it("status: enviado, entregue, lido e falhou são eventos distintos; falha leva o motivo do código", () => {
    const events = wa.normalize(body({ statuses: [
      { id: "wamid.o", status: "sent", recipient_id: "5511988887777" },
      { id: "wamid.o", status: "delivered", recipient_id: "5511988887777" },
      { id: "wamid.o", status: "read", recipient_id: "5511988887777" },
      { id: "wamid.f", status: "failed", recipient_id: "5511988887777", errors: [{ code: 131047, title: "Re-engagement message" }] },
      { id: "wamid.o", status: "deleted" },
    ] }));
    expect(events.map((e) => [e.external_event_id, e.status, e.reason])).toEqual([
      ["st:wamid.o:sent", "sent", undefined], ["st:wamid.o:delivered", "delivered", undefined], ["st:wamid.o:read", "read", undefined],
      ["st:wamid.f:failed", "failed", "window_closed"]]);
  });
  it("outro objeto, formato inesperado ou sem phone_number_id: nada", () => {
    expect(wa.normalize(body({ messages: [{ id: "w", from: "1", type: "text", text: { body: "x" } }] }, "page"))).toEqual([]);
    expect(wa.normalize({ entry: "x" })).toEqual([]);
    expect(wa.normalize({ object: "whatsapp_business_account", entry: [{ changes: [{ value: { messages: [{ id: "w", from: "1", text: { body: "x" } }] } }] }] })).toEqual([]);
  });
  it("assinatura sobre os bytes brutos (acentos incluídos); header ausente, curto ou de outro segredo = inválida", async () => {
    const raw = new TextEncoder().encode(JSON.stringify(body({ messages: [{ id: "w", from: "1", type: "text", text: { body: "ação ✓" } }] })));
    const good = `sha256=${await hmacSha256Hex("app-secret", raw)}`;
    expect(await wa.verifySignature(raw, good)).toBe(true);
    expect(await wa.verifySignature(raw, good.toUpperCase().replace("SHA256=", "sha256="))).toBe(true);
    expect(await wa.verifySignature(raw, null)).toBe(false);
    expect(await wa.verifySignature(raw, "sha256=abc")).toBe(false);
    expect(await wa.verifySignature(raw, `sha256=${await hmacSha256Hex("outro", raw)}`)).toBe(false);
    expect(await wa.verifySignature(raw, `sha1=${await hmacSha256Hex("app-secret", raw)}`)).toBe(false);
  });
});
