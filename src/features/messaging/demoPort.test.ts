import { beforeEach, describe, expect, it } from "vitest";
import { advanceDemoClock, createDemoPort, DEMO_BUSINESS_PHONE, DEMO_CUSTOMERS, resetDemoState } from "./demoPort.ts";

const code = (p: Promise<unknown>) => p.then(() => "ok", (e: { code: string; field?: string }) => `${e.code}/${e.field ?? "-"}`);
const ANA = DEMO_CUSTOMERS[0]!.phone;

async function connected() {
  const port = createDemoPort();
  await port.connect("simulated", DEMO_BUSINESS_PHONE, "c1");
  await port.dispatch!();
  const body = (await port.simPhone(DEMO_BUSINESS_PHONE)).messages[0]!.body;
  await port.verify(/([0-9]{6})/.exec(body)![1]!, "v1");
  return port;
}

describe("demonstração do Canal (mesmas regras do banco)", () => {
  beforeEach(() => resetDemoState());

  it("conectar: código só pelo canal, errado conta tentativa, provedor oficial indisponível na demonstração", async () => {
    const port = createDemoPort();
    expect(await code(port.connect("whatsapp_cloud", DEMO_BUSINESS_PHONE, "w"))).toBe("PROVIDER_UNAVAILABLE/-");
    expect(await code(port.connect("simulated", "11999990001", "x"))).toBe("VALIDATION_ERROR/phone_e164");
    const c = await port.connect("simulated", DEMO_BUSINESS_PHONE, "c1");
    expect(c?.status).toBe("pending_verification");
    expect(await code(port.connect("simulated", "+5511999990002", "c2"))).toBe("POLICY_REJECTED/connection");
    expect((await port.simPhone(DEMO_BUSINESS_PHONE)).messages).toEqual([]);
    expect(await port.dispatch!()).toMatchObject({ sent: 1 });
    const body = (await port.simPhone(DEMO_BUSINESS_PHONE)).messages[0]!.body;
    const right = /([0-9]{6})/.exec(body)![1]!;
    expect(await code(port.verify(right === "000000" ? "111111" : "000000", "v0"))).toBe("POLICY_REJECTED/code");
    expect((await port.verify(right, "v1"))?.status).toBe("active");
    expect((await port.status()).connection?.simulated).toBe(true);
  });

  it("conversa: cliente escreve e é reconhecida; resposta na janela; enviado → lido; duplicado ignorado", async () => {
    const port = await connected();
    expect(await port.simInbound({ kind: "inbound", phone_e164: ANA, text: "Oi, quero marcar" }, "e1")).toEqual({ applied: 1, duplicates: 0 });
    expect(await port.simInbound({ kind: "inbound", phone_e164: ANA, text: "Oi, quero marcar" }, "e1")).toEqual({ applied: 0, duplicates: 1 });
    const [k] = (await port.inbox()).contacts;
    expect(k).toMatchObject({ customer_id: DEMO_CUSTOMERS[0]!.id, customer_name: "Ana Beatriz (exemplo)", window_open: true, unread_count: 1 });
    const m = await port.send({ contact_id: k!.id, kind: "text", text: "Oi, Ana! Quarta às 10h?" }, "s1");
    expect(m.status).toBe("queued");
    expect(await port.dispatch!()).toMatchObject({ sent: 1 });
    const phone = await port.simPhone(ANA);
    expect(phone.messages.at(-1)?.body).toBe("Oi, Ana! Quarta às 10h?");
    const pmid = phone.messages.at(-1)!.provider_message_id!;
    await port.simInbound({ kind: "status", provider_message_id: pmid, status: "read" }, "st1");
    const c = await port.conversation(k!.id);
    expect(c.messages.map((x) => x.status)).toEqual(["received", "read"]);
    expect(await port.simInbound({ kind: "status", provider_message_id: pmid, status: "delivered" }, "st2")).toEqual({ applied: 0, duplicates: 0 });
    expect(c.contact.unread_count).toBe(0);
  });

  it("fora da janela só modelo aprovado; opt-out bloqueia; número inválido falha; 9999 desconhecido sem reenvio", async () => {
    const port = await connected();
    await port.simInbound({ kind: "inbound", phone_e164: ANA, text: "oi" }, "e1");
    const [k] = (await port.inbox()).contacts;
    advanceDemoClock(25 * 60 * 60 * 1000);
    expect(await code(port.send({ contact_id: k!.id, kind: "text", text: "ainda aí?" }, "s0"))).toBe("POLICY_REJECTED/window");
    expect(await code(port.send({ contact_id: k!.id, kind: "template", template_code: "lembrete_agendamento", template_params: ["x"] }, "s1"))).toBe("VALIDATION_ERROR/template_params");
    const t = await port.send({ contact_id: k!.id, kind: "template", template_code: "lembrete_agendamento", template_params: ["Corte", "quarta às 10h"] }, "s2");
    expect(t.body).toContain("Lembrete: Corte em quarta às 10h.");
    await port.simInbound({ kind: "inbound", phone_e164: ANA, text: "SAIR" }, "e2");
    expect(await code(port.send({ contact_id: k!.id, kind: "text", text: "tudo bem" }, "s3"))).toBe("POLICY_REJECTED/opted_out");
    expect((await port.consent(k!.id, true, "o1")).opted_out).toBe(false);
    await port.simInbound({ kind: "inbound", phone_e164: "+5511988880000", text: "oi" }, "e3");
    await port.simInbound({ kind: "inbound", phone_e164: "+5511988889999", text: "oi" }, "e4");
    const inbox = await port.inbox();
    const bad = inbox.contacts.find((x) => x.phone_e164.endsWith("0000"))!;
    const slow = inbox.contacts.find((x) => x.phone_e164.endsWith("9999"))!;
    await port.send({ contact_id: bad.id, kind: "text", text: "x" }, "b1");
    await port.send({ contact_id: slow.id, kind: "text", text: "y" }, "u1");
    expect(await port.dispatch!()).toMatchObject({ sent: 1, failed: 1, unknown: 1, reconciled: 0 });
    expect((await port.conversation(bad.id)).messages.at(-1)).toMatchObject({ status: "failed", failure_reason: "invalid_number" });
    expect((await port.conversation(slow.id)).messages.at(-1)?.status).toBe("delivery_unknown");
    expect((await port.status()).unknown).toBe(1);
    expect(await port.dispatch!()).toMatchObject({ sent: 0, reconciled: 1 });
    expect((await port.conversation(slow.id)).messages.at(-1)?.status).toBe("sent");
    expect((await port.handoff(k!.id, "human", "h1")).handling).toBe("human");
  });

  it("desconectar: fila pendente falha; simulador e envio indisponíveis", async () => {
    const port = await connected();
    await port.simInbound({ kind: "inbound", phone_e164: ANA, text: "oi" }, "e1");
    const [k] = (await port.inbox()).contacts;
    await port.send({ contact_id: k!.id, kind: "text", text: "já respondo" }, "s1");
    expect((await port.disconnect("d1"))?.status).toBe("disconnected");
    expect((await port.conversation(k!.id)).messages.at(-1)).toMatchObject({ status: "failed", failure_reason: "disconnected" });
    expect(await code(port.simPhone(ANA))).toBe("POLICY_REJECTED/provider");
    expect(await code(port.send({ contact_id: k!.id, kind: "text", text: "oi" }, "s2"))).toBe("POLICY_REJECTED/connection");
  });
});
