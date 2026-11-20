// Porta de servidor do Canal contra o registro de contratos (ver harness.ts).
import { describe, expect, it } from "vitest";
import { createServerPort } from "../../../src/features/messaging/serverPort.ts";
import { exercisePort, TENANT, unusedOperations } from "./harness.ts";

const ID = "00000000-0000-4000-8000-0000000000a1";
const PHONE = "+5511988887777";

describe("messaging · porta do servidor", () => {
  it("toda chamada bate com o registro de contratos", async () => {
    const calls = await exercisePort("messaging", (call) => createServerPort(call, TENANT), {
      status: (p) => p.status(),
      connect: (p, key) => p.connect("simulated", PHONE, key),
      verify: (p, key) => p.verify("123456", key),
      disconnect: (p, key) => p.disconnect(key),
      inbox: (p) => p.inbox(),
      unreadCount: (p) => p.unreadCount(),
      conversation: (p) => p.conversation(ID),
      send: (p, key) => p.send({ contact_id: ID, kind: "template", template_code: "lembrete_horario", template_params: ["Ana", "14h"] }, key),
      handoff: (p, key) => p.handoff(ID, "human", key),
      consent: (p, key) => p.consent(ID, false, key),
      link: (p, key) => p.link(ID, null, key),
      simPhone: (p) => p.simPhone(PHONE),
      simInbound: (p, key) => p.simInbound({ kind: "inbound", phone_e164: PHONE, text: "Oi, tem horário?" }, key),
    });

    expect(calls.connect![0]!.body).toEqual({ provider: "simulated", phone_e164: PHONE });
    expect(calls.disconnect![0]!.body).toEqual({});
    expect(calls.consent![0]!.body).toEqual({ contact_id: ID, opted_in: false });
    // Desvincular manda null explícito, não omite o campo.
    expect(calls.link![0]!.body).toEqual({ contact_id: ID, customer_id: null });
    expect(unusedOperations("messaging", calls)).toEqual([]);
  });
});
