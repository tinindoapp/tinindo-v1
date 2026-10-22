import { describe, expect, it, vi } from "vitest";
import { ErrorEnvelope } from "../_shared/contracts/index.ts";
import { FX } from "../_shared/contracts/fixtures.ts";
import { createSimulatedProvider, hmacSha256Hex, type Provider } from "../_shared/domain/messaging/providers.ts";
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

  it("conectar o provedor oficial sem segredos: 503 antes do banco", async () => {
    const { handler, rpc } = setup();
    const res = await handler(new Request(`${base}/channel.connect`, { method: "POST", headers: owner, body: JSON.stringify({ provider: "whatsapp_cloud", phone_e164: "+5511999990001" }) }));
    expect(res.status).toBe(503);
    expect(rpc).not.toHaveBeenCalled();
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
