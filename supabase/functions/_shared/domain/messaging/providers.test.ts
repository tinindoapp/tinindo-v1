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

describe("reexportação do adaptador da Meta", () => {
  it("createWhatsAppProvider continua importável daqui (o adaptador mora em _shared/providers/meta.ts)", () => {
    const wa = createWhatsAppProvider({ accessToken: "tok", appSecret: "app-secret", fetch: vi.fn() });
    expect(wa.name).toBe("whatsapp_cloud");
    expect(wa.configured).toBe(true);
  });
});
