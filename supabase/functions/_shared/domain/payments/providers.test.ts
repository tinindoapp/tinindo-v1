import { describe, expect, it, vi } from "vitest";
import { hmacSha256Hex } from "../messaging/providers.ts";
import { createPspProvider, createSimulatedPaymentProvider, signSimulatedBody } from "./providers.ts";

const req = { ref: "chg:1", tenant_id: "t", amount_cents: 6000, description: "Corte", expires_at: "2026-10-22T13:00:00Z" };

describe("PSP simulado", () => {
  it("cria no livro fictício; 99 falha; 98 fica desconhecido uma vez; consulta lê o livro; estorno só de pago", async () => {
    const rows = new Map<string, Record<string, unknown>>();
    const store = vi.fn(async (fn: string, args: Record<string, unknown>) => {
      if (fn === "payment_sim_create") { rows.set(args.p_external_id as string, { status: "pending", amount_cents: args.p_amount_cents, paid_at: null }); return { data: {}, error: null }; }
      if (fn === "payment_sim_status") return { data: rows.get(args.p_external_id as string) ?? null, error: null };
      if (fn === "payment_sim_transition") {
        const r = rows.get(args.p_external_id as string);
        if (r && ((args.p_status === "refunded" && r.status === "paid") || (args.p_status !== "refunded" && r.status === "pending"))) r.status = args.p_status;
        return { data: r ?? null, error: null };
      }
      return { data: { items: [{ external_id: "sim-a", status: "paid", amount_cents: 1, paid_at: null }] }, error: null };
    });
    const p = createSimulatedPaymentProvider({ secret: "segredo-do-simulador-0000000001", store });
    const created = await p.createCharge(req);
    expect(created).toMatchObject({ outcome: "pending", pix_code: expect.stringContaining("SIMULADO") });
    expect(await p.createCharge({ ...req, amount_cents: 1099 })).toEqual({ outcome: "failed", reason: "amount_rejected" });
    expect(await p.createCharge({ ...req, ref: "chg:2", amount_cents: 1098 })).toEqual({ outcome: "unknown" });
    expect((await p.createCharge({ ...req, ref: "chg:3", amount_cents: 1098 })).outcome).toBe("pending");
    const ext = (created as { external_id: string }).external_id;
    expect(await p.status(ext)).toMatchObject({ status: "pending" });
    expect(await p.status("sim-nunca")).toEqual({ status: "failed" });
    expect(await p.refund(ext, 6000, "rf:1")).toEqual({ outcome: "failed", reason: "not_paid" });
    rows.get(ext)!.status = "paid";
    expect(await p.refund(ext, 6000, "rf:1")).toEqual({ outcome: "done", external_id: `rf-${ext}` });
    expect(await p.status(ext)).toMatchObject({ status: "paid" }); // refunded conta como pago na consulta
    expect(await p.report("t", "2026-10-22")).toEqual([{ external_id: "sim-a", status: "paid", amount_cents: 1, paid_at: null }]);
  });

  it("livro indisponível = erro (o handler trata como desconhecido); assinatura sobre o corpo bruto", async () => {
    const p = createSimulatedPaymentProvider({ secret: "segredo-do-simulador-0000000001", store: vi.fn(async () => ({ data: null, error: { code: "x" } })) });
    await expect(p.createCharge(req)).rejects.toThrow("sim_ledger_unavailable");
    const raw = '{"events":[]}';
    expect(await p.verifySignature(raw, await signSimulatedBody("segredo-do-simulador-0000000001", raw))).toBe(true);
    expect(await p.verifySignature(raw, `sha256=${await hmacSha256Hex("outro", raw)}`)).toBe(false);
    expect(p.normalize({ events: [{ external_event_id: "e", kind: "charge.paid", external_id: "sim-1", amount_cents: 10 }] })).toHaveLength(1);
    expect(p.normalize({ events: [{ kind: "charge.paid" }] })).toEqual([]);
    expect(createSimulatedPaymentProvider({ secret: "curto", store: vi.fn() }).configured).toBe(false);
  });
});

describe("PSP real (esqueleto)", () => {
  const item = { ...req, ref: "chg:9" };

  it("sem credenciais não está configurado: nada é enviado e nada é presumido", async () => {
    const off = createPspProvider({ baseUrl: null, apiKey: null, webhookSecret: null });
    expect(off.configured).toBe(false);
    expect(await off.createCharge(item)).toEqual({ outcome: "unknown" });
    expect(await off.status("x")).toBeNull();
    expect(await off.refund("x", 1, "r")).toEqual({ outcome: "unknown" });
    expect(await off.report("t", "2026-10-22")).toBeNull();
    expect(await off.verifySignature("{}", "sha256=00")).toBe(false);
  });

  it("5xx e timeout = desconhecido; 4xx = falha com código; 200 = pendente com id; consulta e estorno", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("{}", { status: 503 }))
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: "invalid_amount" }), { status: 422 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "ch_1", pix_code: "000201", expires_at: "2026-10-22T14:00:00Z" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "paid", paid_cents: 6000, paid_at: "2026-10-22T13:30:00Z" }), { status: 200 }))
      .mockResolvedValueOnce(new Response("{}", { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "rf_1" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [{ charge_id: "ch_1", status: "paid", amount_cents: 6000, paid_at: "x" }, { charge_id: "zz" }] }), { status: 200 }));
    const p = createPspProvider({ baseUrl: "https://psp.test/v1/", apiKey: "k", webhookSecret: "s", fetch: fetchMock });
    expect(await p.createCharge(item)).toEqual({ outcome: "unknown" });
    expect(await p.createCharge(item)).toEqual({ outcome: "unknown" });
    expect(await p.createCharge(item)).toEqual({ outcome: "failed", reason: "psp_422_invalid_amount" });
    expect(await p.createCharge(item)).toEqual({ outcome: "pending", external_id: "ch_1", pix_code: "000201", checkout_url: null, expires_at: "2026-10-22T14:00:00Z" });
    const init = (fetchMock.mock.calls[3] as [string, RequestInit])[1];
    expect((fetchMock.mock.calls[3] as [string])[0]).toBe("https://psp.test/v1/charges");
    expect((init.headers as Record<string, string>)["Idempotency-Key"]).toBe("chg:9");
    expect(await p.status("ch_1")).toEqual({ status: "paid", paid_cents: 6000, paid_at: "2026-10-22T13:30:00Z" });
    expect(await p.status("ch_404")).toEqual({ status: "failed" });
    expect(await p.refund("ch_1", 6000, "rf:1")).toEqual({ outcome: "done", external_id: "rf_1" });
    expect(await p.report("t", "2026-10-22")).toEqual([{ external_id: "ch_1", status: "paid", amount_cents: 6000, paid_at: "x" }]);
  });

  it("normaliza o webhook genérico e ignora tipos desconhecidos; assinatura HMAC", async () => {
    const p = createPspProvider({ baseUrl: "https://psp.test", apiKey: "k", webhookSecret: "segredo-do-psp", fetch: vi.fn() });
    expect(p.normalize({ id: "evt_1", type: "charge.paid", data: { charge_id: "ch_1", amount_cents: 6000, paid_at: "2026-10-22T13:30:00Z" } }))
      .toEqual([{ external_event_id: "evt_1", kind: "charge.paid", external_id: "ch_1", amount_cents: 6000, paid_at: "2026-10-22T13:30:00Z", refund_external_id: undefined, reason: undefined }]);
    expect(p.normalize({ id: "evt_2", type: "refund.succeeded", data: { charge_id: "ch_1", refund_id: "rf_1" } })[0]?.kind).toBe("refund.done");
    expect(p.normalize({ id: "evt_3", type: "customer.created", data: { charge_id: "x" } })).toEqual([]);
    expect(p.normalize("lixo")).toEqual([]);
    const raw = '{"id":"evt_1"}';
    expect(await p.verifySignature(raw, `sha256=${await hmacSha256Hex("segredo-do-psp", raw)}`)).toBe(true);
    expect(await p.verifySignature(raw, `sha256=${await hmacSha256Hex("errado", raw)}`)).toBe(false);
  });
});
