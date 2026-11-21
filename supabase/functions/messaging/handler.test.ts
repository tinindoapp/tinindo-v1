import { describe, expect, it, vi } from "vitest";
import { ErrorEnvelope } from "../_shared/contracts/index.ts";
import { FX } from "../_shared/contracts/fixtures.ts";
import { createSimulatedProvider, hmacSha256Hex, type Provider } from "../_shared/domain/messaging/providers.ts";
import { messagingChoice } from "../_shared/providers/selection.ts";
import { createMessagingHandler, DISPATCH_SECRET_HEADER, type MessagingDeps, SIGNATURE_HEADER } from "./handler.ts";

const SIM_SECRET = "segredo-do-simulador-0000000001";
const DISPATCH = "segredo-do-despacho-com-mais-de-32-caracteres";
const base = "http://edge/functions/v1/messaging";

function setup(over: Partial<MessagingDeps> = {}) {
  const serviceRpc = vi.fn(async (fn: string, _args?: Record<string, unknown>) => ({ data: fn === "channel_webhook_ingest" ? { applied: 1, duplicates: 0 } : { items: [] }, error: null }));
  const rpc = vi.fn(async () => ({ data: { connection: { provider: "simulated", status: "active", phone_e164: "+5511999990001" } }, error: null }));
  const deliver = vi.fn(async () => undefined);
  const deps: MessagingDeps = {
    allowedOrigins: [], dispatchSecret: DISPATCH, simulatedSecret: SIM_SECRET, verifyToken: "token-de-verificacao",
    providers: { simulated: createSimulatedProvider({ secret: SIM_SECRET, deliver }) },
    serviceRpc, rpc, ...over,
  };
  return { handler: createMessagingHandler(deps), serviceRpc, rpc, deliver };
}
const raw = JSON.stringify({ events: [{ external_event_id: "e1", kind: "inbound", external_account_id: "+5511999990001", phone_e164: "+5511988887777", text: "oi" }] });

describe("messaging · webhook", () => {
  it("assinatura inválida: 401 e nada é lido", async () => {
    const { handler, serviceRpc } = setup();
    const res = await handler(new Request(`${base}/channel.webhook/simulated`, { method: "POST", body: raw, headers: { [SIGNATURE_HEADER]: "sha256=" + "0".repeat(64) } }));
    expect(res.status).toBe(401);
    expect(serviceRpc).not.toHaveBeenCalled();
  });

  it("assinatura válida sobre o corpo bruto: eventos normalizados vão à ingestão", async () => {
    const { handler, serviceRpc } = setup();
    const sig = `sha256=${await hmacSha256Hex(SIM_SECRET, raw)}`;
    const res = await handler(new Request(`${base}/channel.webhook/simulated`, { method: "POST", body: raw, headers: { [SIGNATURE_HEADER]: sig } }));
    expect(res.status).toBe(200);
    expect(serviceRpc).toHaveBeenCalledWith("channel_webhook_ingest", { p_provider: "simulated", p_events: [expect.objectContaining({ external_event_id: "e1", kind: "inbound" })] });
    // Corpo alterado depois de assinado: recusado.
    const tampered = await handler(new Request(`${base}/channel.webhook/simulated`, { method: "POST", body: raw.replace("oi", "oi!"), headers: { [SIGNATURE_HEADER]: sig } }));
    expect(tampered.status).toBe(401);
  });

  it("provedor desconhecido na rota: 404; GET do desafio só na API oficial com o token certo", async () => {
    const wa: Provider = { name: "whatsapp_cloud", configured: true, send: vi.fn(), status: vi.fn(), verifySignature: vi.fn(async () => true), normalize: () => [] };
    const { handler } = setup({ providers: { simulated: createSimulatedProvider({ secret: SIM_SECRET, deliver: vi.fn() }), whatsapp_cloud: wa } });
    expect((await handler(new Request(`${base}/channel.webhook/telegram`, { method: "POST", body: "{}" }))).status).toBe(404);
    const okRes = await handler(new Request(`${base}/channel.webhook/whatsapp_cloud?hub.mode=subscribe&hub.verify_token=token-de-verificacao&hub.challenge=12345`));
    expect(okRes.status).toBe(200);
    expect(await okRes.text()).toBe("12345");
    expect((await handler(new Request(`${base}/channel.webhook/whatsapp_cloud?hub.mode=subscribe&hub.verify_token=errado&hub.challenge=1`))).status).toBe(403);
    expect((await handler(new Request(`${base}/channel.webhook/simulated?hub.mode=subscribe&hub.verify_token=token-de-verificacao&hub.challenge=1`))).status).toBe(403);
  });

  it("log não leva telefone nem texto", async () => {
    const log = vi.fn();
    const { handler } = setup({ log });
    const sig = `sha256=${await hmacSha256Hex(SIM_SECRET, raw)}`;
    await handler(new Request(`${base}/channel.webhook/simulated`, { method: "POST", body: raw, headers: { [SIGNATURE_HEADER]: sig } }));
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/5511|oi/);
  });
});

describe("messaging · despacho", () => {
  it("sem o segredo não despacha", async () => {
    const { handler, serviceRpc } = setup();
    const res = await handler(new Request(`${base}/channel.dispatch`, { method: "POST", headers: { [DISPATCH_SECRET_HEADER]: "x".repeat(40) } }));
    expect(res.status).toBe(401);
    expect(serviceRpc).not.toHaveBeenCalled();
  });

  it("reserva a fila, envia pelo provedor e grava cada resultado; número inválido falha; 9999 fica desconhecido e depois é consultado", async () => {
    const items = [
      { ref: "msg:a", provider: "simulated", external_account_id: "+5511999990001", to: "+5511988887777", body: "ok", kind: "text", template_code: null, template_params: null },
      { ref: "msg:b", provider: "simulated", external_account_id: "+5511999990001", to: "+5511988880000", body: "x", kind: "text", template_code: null, template_params: null },
      { ref: "msg:c", provider: "simulated", external_account_id: "+5511999990001", to: "+5511988889999", body: "y", kind: "text", template_code: null, template_params: null },
    ];
    const serviceRpc = vi.fn(async (fn: string, _args?: Record<string, unknown>) => {
      if (fn === "channel_dispatch_claim") return { data: { items }, error: null };
      if (fn === "channel_dispatch_unknown") return { data: { items: [{ ref: "msg:c", provider: "simulated", provider_message_id: null }] }, error: null };
      return { data: {}, error: null };
    });
    const { handler, deliver } = setup({ serviceRpc });
    const res = await handler(new Request(`${base}/channel.dispatch`, { method: "POST", headers: { [DISPATCH_SECRET_HEADER]: DISPATCH } }));
    expect(await res.json()).toMatchObject({ data: { provider_configured: true, sent: 1, failed: 1, unknown: 1, reconciled: 1 } });
    expect(deliver).toHaveBeenCalledTimes(1);
    const results = serviceRpc.mock.calls.filter((c) => c[0] === "channel_dispatch_result").map((c) => c[1] as unknown as Record<string, unknown>);
    expect(results.map((r) => [r.p_ref, r.p_outcome])).toEqual([["msg:a", "sent"], ["msg:b", "failed"], ["msg:c", "delivery_unknown"], ["msg:c", "sent"]]);
  });

  it("provedor não configurado: a mensagem falha com motivo explícito, sem reenvio", async () => {
    const wa: Provider = { name: "whatsapp_cloud", configured: false, send: vi.fn(), status: vi.fn(), verifySignature: vi.fn(), normalize: () => [] };
    const serviceRpc = vi.fn(async (fn: string, _args?: Record<string, unknown>) => ({ data: fn === "channel_dispatch_claim"
      ? { items: [{ ref: "msg:w", provider: "whatsapp_cloud", external_account_id: "123", to: "+5511988887777", body: "x", kind: "text", template_code: null, template_params: null }] }
      : { items: [] }, error: null }));
    const { handler } = setup({ serviceRpc, providers: { whatsapp_cloud: wa } });
    const res = await handler(new Request(`${base}/channel.dispatch`, { method: "POST", headers: { [DISPATCH_SECRET_HEADER]: DISPATCH } }));
    expect(await res.json()).toMatchObject({ data: { provider_configured: false, failed: 1 } });
    expect(wa.send).not.toHaveBeenCalled();
    expect(serviceRpc).toHaveBeenCalledWith("channel_dispatch_result", expect.objectContaining({ p_outcome: "failed", p_reason: "provider_not_configured" }));
  });
});

describe("messaging · dono e simulador", () => {
  const owner = { Authorization: "Bearer jwt", "X-Tinindo-Tenant": FX.tenants.A, "Idempotency-Key": "chave-simulador-00001", "Content-Type": "application/json" };

  it("MESSAGING_PROVIDER=meta sem segredos: conectar responde 503 antes do banco", async () => {
    const choice = messagingChoice((k) => ({ MESSAGING_PROVIDER: "meta" } as Record<string, string>)[k]);
    const { handler, rpc } = setup({ choice });
    const res = await handler(new Request(`${base}/channel.connect`, { method: "POST", headers: owner, body: JSON.stringify({ phone_e164: "+5511999990001" }) }));
    expect(res.status).toBe(503);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("o número nasce no provedor do segredo: o `provider` do corpo é ignorado", async () => {
    const { handler, rpc } = setup();
    await handler(new Request(`${base}/channel.connect`, { method: "POST", headers: owner, body: JSON.stringify({ provider: "whatsapp_cloud", phone_e164: "+5511999990001" }) }));
    // (a resposta do mock não é uma conexão completa; aqui só importa o que foi ao banco)
    expect(rpc).toHaveBeenCalledWith("jwt", "channel_connect", expect.objectContaining({ p_provider: "simulated" }));
  });

  it("channel.status leva o provedor ativo e se está configurado, sem segredo nenhum", async () => {
    const choice = messagingChoice((k) => ({ MESSAGING_PROVIDER: "meta", WHATSAPP_ACCESS_TOKEN: "tok-secreto" } as Record<string, string>)[k]);
    const { handler } = setup({ choice, rpc: vi.fn(async () => ({ data: { connection: null, queued: 0, unknown: 0, templates: [] }, error: null })) });
    const res = await handler(new Request(`${base}/channel.status`, { method: "POST", headers: owner, body: "{}" }));
    const text = await res.text();
    expect(JSON.parse(text).data.provider).toEqual({ active: "whatsapp_cloud", real: true, configured: false });
    expect(text).not.toContain("tok-secreto");
  });

  it("sim.inbound monta o webhook assinado e passa pelo mesmo caminho; a chave vira o id do evento", async () => {
    const { handler, serviceRpc } = setup();
    const res = await handler(new Request(`${base}/sim.inbound`, { method: "POST", headers: owner, body: JSON.stringify({ kind: "inbound", phone_e164: "+5511988887777", text: "oi" }) }));
    expect(res.status).toBe(200);
    expect(serviceRpc).toHaveBeenCalledWith("channel_webhook_ingest", { p_provider: "simulated", p_events: [expect.objectContaining({ external_event_id: "sim:chave-simulador-00001", phone_e164: "+5511988887777" })] });
  });

  it("sim.inbound só com conexão simulada ativa", async () => {
    const rpc = vi.fn(async () => ({ data: { connection: { provider: "whatsapp_cloud", status: "active", phone_e164: "+55" } }, error: null }));
    const { handler, serviceRpc } = setup({ rpc });
    const res = await handler(new Request(`${base}/sim.inbound`, { method: "POST", headers: owner, body: JSON.stringify({ kind: "inbound", phone_e164: "+5511988887777", text: "oi" }) }));
    expect(ErrorEnvelope.parse(await res.json()).error.code).toBe("POLICY_REJECTED");
    expect(serviceRpc).not.toHaveBeenCalled();
  });

  it("verificação com código errado: o envelope 422 do banco vira POLICY_REJECTED/code (tentativa gravada)", async () => {
    const rpc = vi.fn(async () => ({ data: { status_code: 422, error: "POLICY_REJECTED", field: "code" }, error: null }));
    const { handler } = setup({ rpc });
    const res = await handler(new Request(`${base}/channel.verify`, { method: "POST", headers: owner, body: JSON.stringify({ code: "123456" }) }));
    expect(res.status).toBe(422);
    expect(ErrorEnvelope.parse(await res.json()).error.field).toBe("code");
  });
});

describe("messaging · WhatsApp oficial (Meta)", () => {
  const owner = { Authorization: "Bearer jwt", "X-Tinindo-Tenant": FX.tenants.A, "Idempotency-Key": "chave-conectar-meta-01", "Content-Type": "application/json" };
  const metaChoice = messagingChoice((k) => ({ MESSAGING_PROVIDER: "meta", WHATSAPP_ACCESS_TOKEN: "t", WHATSAPP_APP_SECRET: "s", WHATSAPP_VERIFY_TOKEN: "v" } as Record<string, string>)[k]);
  const metaProvider = (lookup: Provider["lookup"], send: Provider["send"] = vi.fn()): Provider =>
    ({ name: "whatsapp_cloud", configured: true, send, status: vi.fn(async () => null), verifySignature: vi.fn(async () => true), normalize: () => [], lookup });
  const connectBody = { phone_e164: "+5511999990001", external_account_id: "1029384756", verify_to_e164: "+5511988887777" };
  const connect = (handler: (r: Request) => Promise<Response>, body: unknown) =>
    handler(new Request(`${base}/channel.connect`, { method: "POST", headers: owner, body: JSON.stringify(body) }));
  const created = { status_code: 201, body: { connection: { id: FX.tenants.A, provider: "whatsapp_cloud", phone_e164: "+5511999990001", status: "pending_verification", verified_at: null, version: 1, simulated: false } } };
  const rpcOk = () => vi.fn(async (_t: string, fn: string) => ({ data: fn === "channel_status" ? { connection: null } : created, error: null }));
  const dispatch = (handler: (r: Request) => Promise<Response>) =>
    handler(new Request(`${base}/channel.dispatch`, { method: "POST", headers: { [DISPATCH_SECRET_HEADER]: DISPATCH } }));

  it("conectar: a Graph confirma que o ID é do mesmo número; o banco recebe o ID e o WhatsApp pessoal do código", async () => {
    const lookup = vi.fn(async () => ({ outcome: "found" as const, display_phone_number: "+55 11 99999-0001", verified_name: "Barbearia", quality_rating: "GREEN" }));
    const rpc = rpcOk();
    const { handler } = setup({ choice: metaChoice, rpc, providers: { whatsapp_cloud: metaProvider(lookup) } });
    const res = await connect(handler, connectBody);
    expect(res.status).toBe(201);
    expect(lookup).toHaveBeenCalledWith("1029384756");
    expect(rpc).toHaveBeenCalledWith("jwt", "channel_connect", expect.objectContaining({ p_provider: "whatsapp_cloud", p_external_account_id: "1029384756", p_verify_to_e164: "+5511988887777" }));
  });

  it("conectar: sem ID, sem WhatsApp pessoal ou com o mesmo número = campo certo, sem Graph e sem banco", async () => {
    const lookup = vi.fn();
    const rpc = rpcOk();
    const { handler } = setup({ choice: metaChoice, rpc, providers: { whatsapp_cloud: metaProvider(lookup) } });
    const field = async (b: unknown) => ErrorEnvelope.parse(await (await connect(handler, b)).json()).error.field;
    expect(await field({ ...connectBody, external_account_id: null })).toBe("external_account_id");
    expect(await field({ ...connectBody, external_account_id: "abc123" })).toBe("external_account_id");
    expect(await field({ ...connectBody, verify_to_e164: null })).toBe("verify_to_e164");
    expect(await field({ ...connectBody, verify_to_e164: connectBody.phone_e164 })).toBe("verify_to_e164");
    expect(lookup).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("conectar: ID que a Meta não reconhece, ID de outro número ou Graph fora do ar = nada gravado", async () => {
    const cases = [
      [{ outcome: "not_found", reason: "graph_400_100" }, "POLICY_REJECTED", "external_account_id"],
      [{ outcome: "found", display_phone_number: "+55 21 98888-0000", verified_name: null, quality_rating: null }, "POLICY_REJECTED", "display_phone_number"],
      [{ outcome: "unavailable" }, "PROVIDER_UNAVAILABLE", undefined],
    ] as const;
    for (const [found, code, fieldName] of cases) {
      const rpc = rpcOk();
      const { handler } = setup({ choice: metaChoice, rpc, providers: { whatsapp_cloud: metaProvider(vi.fn(async () => found)) } });
      const err = ErrorEnvelope.parse(await (await connect(handler, connectBody)).json()).error;
      expect([err.code, err.field]).toEqual([code, fieldName]);
      expect(rpc.mock.calls.map((c) => c[1])).toEqual(["channel_status"]);
    }
  });

  it("conectar: quem não é dono não chega à Graph", async () => {
    const lookup = vi.fn();
    const rpc = vi.fn(async () => ({ data: null, error: { code: "PT403", message: "FORBIDDEN" } }));
    const { handler } = setup({ choice: metaChoice, rpc, providers: { whatsapp_cloud: metaProvider(lookup) } });
    expect((await connect(handler, connectBody)).status).toBe(403);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("despacho: limite do número volta à fila; o resto do mesmo número nesta rodada volta sem chamar a Meta; outro número segue", async () => {
    const mk = (ref: string, account: string, to: string) => ({ ref, provider: "whatsapp_cloud", external_account_id: account, to, body: "x", kind: "text", template_code: null, template_params: null });
    const items = [mk("msg:1", "111", "+5511900000001"), mk("msg:2", "111", "+5511900000002"), mk("msg:3", "222", "+5511900000003"),
      mk("msg:4", "222", "+5511900000004"), mk("msg:5", "222", "+5511900000004")];
    const send = vi.fn(async (i: { ref: string }) => {
      if (i.ref === "msg:1") return { outcome: "retry" as const, reason: "throughput_limit", scope: "number" as const, retry_after_s: 30 };
      if (i.ref === "msg:4") return { outcome: "retry" as const, reason: "pair_rate_limit", scope: "pair" as const };
      return { outcome: "sent" as const, provider_message_id: `wamid.${i.ref}` };
    });
    const serviceRpc = vi.fn(async (fn: string, _args?: Record<string, unknown>) => ({ data: fn === "channel_dispatch_claim" ? { items } : { items: [] }, error: null }));
    const { handler } = setup({ serviceRpc, providers: { whatsapp_cloud: metaProvider(vi.fn(), send as Provider["send"]) } });
    expect(await (await dispatch(handler)).json()).toMatchObject({ data: { sent: 1, failed: 0, unknown: 0, retried: 4 } });
    expect(send.mock.calls.map((c) => c[0].ref)).toEqual(["msg:1", "msg:3", "msg:4"]);
    const results = serviceRpc.mock.calls.filter((c) => c[0] === "channel_dispatch_result").map((c) => c[1] as Record<string, unknown>);
    expect(results.map((r) => [r.p_ref, r.p_outcome, r.p_reason, r.p_retry_after_s])).toEqual([
      ["msg:1", "retry", "throughput_limit", 30], ["msg:2", "requeue", "rate_limited_round", null], ["msg:3", "sent", null, null],
      ["msg:4", "retry", "pair_rate_limit", null], ["msg:5", "requeue", "rate_limited_round", null]]);
  });

  it("despacho: limite da conta segura todo o resto da rodada", async () => {
    const items = ["a", "b", "c"].map((r, n) => ({ ref: `msg:${r}`, provider: "whatsapp_cloud", external_account_id: String(100 + n), to: `+551190000000${n}`, body: "x", kind: "text", template_code: null, template_params: null }));
    const send = vi.fn(async () => ({ outcome: "retry" as const, reason: "account_rate_limit", scope: "account" as const }));
    const serviceRpc = vi.fn(async (fn: string, _args?: Record<string, unknown>) => ({ data: fn === "channel_dispatch_claim" ? { items } : { items: [] }, error: null }));
    const { handler } = setup({ serviceRpc, providers: { whatsapp_cloud: metaProvider(vi.fn(), send) } });
    await dispatch(handler);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("webhook: corpo com acento assinado sobre os bytes; corpo que não é UTF-8 válido ou grande demais é recusado", async () => {
    const { handler, serviceRpc } = setup();
    const rawAcc = JSON.stringify({ events: [{ external_event_id: "e-acento", kind: "inbound", external_account_id: "+5511999990001", phone_e164: "+5511988887777", text: "ação ✓" }] });
    const sig = `sha256=${await hmacSha256Hex(SIM_SECRET, rawAcc)}`;
    expect((await handler(new Request(`${base}/channel.webhook/simulated`, { method: "POST", body: rawAcc, headers: { [SIGNATURE_HEADER]: sig } }))).status).toBe(200);
    expect(serviceRpc).toHaveBeenCalledWith("channel_webhook_ingest", expect.objectContaining({ p_events: [expect.objectContaining({ text: "ação ✓" })] }));
    const bad = new Uint8Array([0x7b, 0xff, 0xfe, 0x7d]);
    const badSig = `sha256=${await hmacSha256Hex(SIM_SECRET, bad)}`;
    expect((await handler(new Request(`${base}/channel.webhook/simulated`, { method: "POST", body: bad, headers: { [SIGNATURE_HEADER]: badSig } }))).status).toBe(400);
    expect((await handler(new Request(`${base}/channel.webhook/simulated`, { method: "POST", body: "x".repeat(300 * 1024), headers: { [SIGNATURE_HEADER]: sig } }))).status).toBe(400);
  });
});
