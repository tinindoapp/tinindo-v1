import { describe, expect, it, vi } from "vitest";
import { createSimulatedProvider, createWhatsAppProvider, hmacSha256Hex } from "./providers.ts";

const item = { ref: "msg:1", provider: "simulated" as const, external_account_id: "+5511999990001", to: "+5511988887777", body: "Olá", kind: "text" as const, template_code: null, template_params: null };

describe("provedor simulado", () => {
  it("entrega ao telefone fictício; 0000 falha; 9999 fica desconhecido uma vez e a consulta resolve", async () => {
    const deliver = vi.fn(async () => undefined);
    const p = createSimulatedProvider({ secret: "segredo-do-simulador-0000000001", deliver });
    expect(await p.send(item)).toMatchObject({ outcome: "sent" });
    expect(deliver).toHaveBeenCalledWith("+5511988887777", "+5511999990001", "Olá", expect.stringMatching(/^sim-/));
    expect(await p.send({ ...item, to: "+5511988880000" })).toEqual({ outcome: "failed", reason: "invalid_number" });
    expect(await p.send({ ...item, ref: "msg:u", to: "+5511988889999" })).toEqual({ outcome: "delivery_unknown" });
    expect(await p.status(null, "msg:u")).toBe("sent");
    expect(await p.status(null, "msg:nunca")).toBeNull();
  });

  it("segredo curto = não configurado; assinatura confere sobre o corpo bruto", async () => {
    expect(createSimulatedProvider({ secret: "curto", deliver: vi.fn() }).configured).toBe(false);
    const p = createSimulatedProvider({ secret: "segredo-do-simulador-0000000001", deliver: vi.fn() });
    const raw = '{"events":[]}';
    expect(await p.verifySignature(raw, `sha256=${await hmacSha256Hex("segredo-do-simulador-0000000001", raw)}`)).toBe(true);
    expect(await p.verifySignature(raw, `sha256=${await hmacSha256Hex("outro", raw)}`)).toBe(false);
    expect(await p.verifySignature(raw, null)).toBe(false);
    expect(p.normalize({ nada: true })).toEqual([]);
  });
});

describe("WhatsApp Cloud API", () => {
  const wa = createWhatsAppProvider({ accessToken: "tok", appSecret: "app-secret", graphUrl: "https://graph.test/v21.0", fetch: vi.fn() });

  it("normaliza mensagens de texto e status; ignora mídia e formato inesperado", () => {
    const events = wa.normalize({ object: "whatsapp_business_account", entry: [{ changes: [{ value: {
      metadata: { phone_number_id: "123" },
      contacts: [{ wa_id: "5511988887777", profile: { name: "Ana" } }],
      messages: [{ id: "wamid.1", from: "5511988887777", type: "text", text: { body: "oi" } }, { id: "wamid.2", from: "5511988887777", type: "image" }],
      statuses: [{ id: "wamid.out", status: "delivered", recipient_id: "5511988887777" }, { id: "wamid.out", status: "deleted" }],
    } }] }] });
    expect(events).toEqual([
      { external_event_id: "msg:wamid.1", kind: "inbound", external_account_id: "123", phone_e164: "+5511988887777", text: "oi", profile_name: "Ana" },
      { external_event_id: "st:wamid.out:delivered", kind: "status", external_account_id: "123", provider_message_id: "wamid.out", status: "delivered", reason: undefined },
    ]);
    expect(wa.normalize({ entry: "x" })).toEqual([]);
  });

  it("sem segredos não está configurado; envio vira desconhecido, nunca sucesso", async () => {
    const off = createWhatsAppProvider({ accessToken: null, appSecret: null });
    expect(off.configured).toBe(false);
    expect(await off.send({ ...item, provider: "whatsapp_cloud" })).toEqual({ outcome: "delivery_unknown" });
    expect(await off.verifySignature("{}", "sha256=00")).toBe(false);
  });

  it("5xx e timeout = desconhecido; 4xx = falha com código; 200 = enviado com o id do provedor", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("{}", { status: 503 }))
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 131026 } }), { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ messages: [{ id: "wamid.x" }] }), { status: 200 }));
    const p = createWhatsAppProvider({ accessToken: "tok", appSecret: "s", fetch: fetchMock });
    const i = { ...item, provider: "whatsapp_cloud" as const, external_account_id: "123" };
    expect(await p.send(i)).toEqual({ outcome: "delivery_unknown" });
    expect(await p.send(i)).toEqual({ outcome: "delivery_unknown" });
    expect(await p.send(i)).toEqual({ outcome: "failed", reason: "graph_400_131026" });
    expect(await p.send(i)).toEqual({ outcome: "sent", provider_message_id: "wamid.x" });
    const body = JSON.parse((fetchMock.mock.calls[3] as [string, RequestInit])[1].body as string);
    expect(body).toMatchObject({ messaging_product: "whatsapp", to: "5511988887777", type: "text" });
    expect(await p.status("wamid.x", "msg:1")).toBeNull();
  });
});
