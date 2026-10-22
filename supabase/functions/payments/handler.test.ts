import { describe, expect, it, vi } from "vitest";
import { ErrorEnvelope } from "../_shared/contracts/index.ts";
import { FX } from "../_shared/contracts/fixtures.ts";
import { hmacSha256Hex } from "../_shared/domain/messaging/providers.ts";
import { createSimulatedPaymentProvider, type PaymentProviderPort } from "../_shared/domain/payments/providers.ts";
import { createPaymentsHandler, type PaymentsDeps, SIGNATURE_HEADER, SYNC_SECRET_HEADER } from "./handler.ts";

const SIM_SECRET = "segredo-do-simulador-0000000001";
const SYNC = "segredo-do-sync-com-mais-de-32-caracteres";
const base = "http://edge/functions/v1/payments";
const CHARGE = {
  id: "c0000000-0000-4000-8000-000000000001", receivable_id: "d0000000-0000-4000-8000-000000000001", customer_id: null, provider: "simulated", simulated: true,
  external_id: null, amount_cents: 6000, description: "Corte", status: "creating", pix_code: null, checkout_url: null, expires_at: null, paid_at: null, paid_cents: null,
  payment_entry_id: null, settlement: null, failure_reason: null, refund_status: null, created_at: "2026-10-22T12:00:00Z", version: 1,
};
const owner = { Authorization: "Bearer jwt", "X-Tinindo-Tenant": FX.tenants.A, "Idempotency-Key": "chave-pagamento-00001", "Content-Type": "application/json" };

function setup(over: Partial<PaymentsDeps> = {}) {
  const ledger = new Map<string, Record<string, unknown>>([["sim-1", { status: "pending", amount_cents: 6000, paid_at: null }]]);
  const serviceRpc = vi.fn(async (fn: string, args?: Record<string, unknown>) => {
    const a = args ?? {};
    if (fn === "payment_charge_result") return { data: { status: "applied", charge: { ...CHARGE, status: a.p_outcome, external_id: a.p_external_id ?? null, pix_code: a.p_pix_code ?? null, version: 2 } }, error: null };
    if (fn === "payment_sim_create") { ledger.set(a.p_external_id as string, { status: "pending", amount_cents: a.p_amount_cents }); return { data: {}, error: null }; }
    if (fn === "payment_sim_status") return { data: ledger.get(a.p_external_id as string) ?? null, error: null };
    if (fn === "payment_sim_transition") { const r = ledger.get(a.p_external_id as string); if (r) r.status = a.p_status; return { data: r ? { ...r, changed: true } : null, error: null }; }
    if (fn === "payment_webhook_ingest") return { data: { applied: (a.p_events as unknown[]).length, duplicates: 0 }, error: null };
    if (fn === "payment_charge_lookup") return { data: { charge: { ...CHARGE, status: "pending", external_id: "sim-1" } }, error: null };
    if (fn === "payment_sync_claim") return { data: { items: [] }, error: null };
    return { data: {}, error: null };
  });
  const rpc = vi.fn(async (_t: string, fn: string) => fn === "payment_charge_create"
    ? { data: { status_code: 201, body: { charge: CHARGE, link_token: "t".repeat(43) } }, error: null }
    : { data: { status_code: 200, body: {} }, error: null });
  const anonRpc = vi.fn(async () => ({ data: { charge_id: CHARGE.id, business_name: "Barbearia", description: "Corte", amount_cents: 6000, provider: "simulated", simulated: true, status: "pending", pix_code: "x", checkout_url: null, expires_at: null, paid_at: null }, error: null }));
  const store = over.serviceRpc ?? serviceRpc;
  const deps: PaymentsDeps = {
    allowedOrigins: [], syncSecret: SYNC, simulatedSecret: SIM_SECRET, publicAppUrl: "https://app.exemplo.test/",
    providers: { simulated: createSimulatedPaymentProvider({ secret: SIM_SECRET, store: (fn, args) => store(fn, args) }) },
    serviceRpc, rpc, anonRpc, ...over,
  };
  return { handler: createPaymentsHandler(deps), serviceRpc: (over.serviceRpc ?? serviceRpc) as typeof serviceRpc, rpc, anonRpc };
}

describe("payments · criação", () => {
  it("cria no banco, pede ao PSP, grava o resultado pelo backend e devolve a cobrança com o link (token nunca logado)", async () => {
    const log = vi.fn();
    const { handler, serviceRpc } = setup({ log });
    const res = await handler(new Request(`${base}/payment.charge_create`, { method: "POST", headers: owner, body: JSON.stringify({ receivable_id: CHARGE.receivable_id, provider: "simulated" }) }));
    expect(res.status).toBe(201);
    const data = (await res.json() as { data: { charge: { status: string; external_id: string }; pay_url: string } }).data;
    expect(data.charge.status).toBe("pending");
    expect(data.charge.external_id).toMatch(/^sim-/);
    expect(data.pay_url).toBe(`https://app.exemplo.test/pagar#t=${"t".repeat(43)}`);
    expect(serviceRpc).toHaveBeenCalledWith("payment_charge_result", expect.objectContaining({ p_charge_id: CHARGE.id, p_outcome: "pending" }));
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/tttt|6000|Corte/);
  });

  it("PSP real sem credenciais: 503 antes do banco; PSP fictício sem livro: desconhecido, nunca pago", async () => {
    const psp: PaymentProviderPort = { name: "psp", configured: false, createCharge: vi.fn(), status: vi.fn(), cancel: vi.fn(), refund: vi.fn(), report: vi.fn(), verifySignature: vi.fn(), normalize: () => [] };
    const { handler, rpc } = setup({ providers: { psp } });
    const res = await handler(new Request(`${base}/payment.charge_create`, { method: "POST", headers: owner, body: JSON.stringify({ receivable_id: CHARGE.receivable_id, provider: "psp" }) }));
    expect(res.status).toBe(503);
    expect(rpc).not.toHaveBeenCalled();
    const broken = setup({ serviceRpc: vi.fn(async (fn: string) => fn === "payment_charge_result" ? { data: { charge: { ...CHARGE, status: "unknown" } }, error: null } : { data: null, error: { code: "x" } }) });
    const r2 = await broken.handler(new Request(`${base}/payment.charge_create`, { method: "POST", headers: owner, body: JSON.stringify({ receivable_id: CHARGE.receivable_id, provider: "simulated" }) }));
    expect((await r2.json() as { data: { charge: { status: string } } }).data.charge.status).toBe("unknown");
    expect(broken.serviceRpc).toHaveBeenCalledWith("payment_charge_result", expect.objectContaining({ p_outcome: "unknown" }));
  });
});

describe("payments · webhook e sync", () => {
  const raw = JSON.stringify({ events: [{ external_event_id: "e1", kind: "charge.paid", external_id: "sim-1", amount_cents: 6000 }] });

  it("assinatura inválida: 401 e nada é lido; válida: ingestão; corpo alterado: 401", async () => {
    const { handler, serviceRpc } = setup();
    expect((await handler(new Request(`${base}/payment.webhook/simulated`, { method: "POST", body: raw, headers: { [SIGNATURE_HEADER]: "sha256=" + "0".repeat(64) } }))).status).toBe(401);
    expect(serviceRpc).not.toHaveBeenCalled();
    const sig = `sha256=${await hmacSha256Hex(SIM_SECRET, raw)}`;
    const okRes = await handler(new Request(`${base}/payment.webhook/simulated`, { method: "POST", body: raw, headers: { [SIGNATURE_HEADER]: sig } }));
    expect(okRes.status).toBe(200);
    expect(serviceRpc).toHaveBeenCalledWith("payment_webhook_ingest", { p_provider: "simulated", p_events: [expect.objectContaining({ external_event_id: "e1", kind: "charge.paid" })] });
    expect((await handler(new Request(`${base}/payment.webhook/simulated`, { method: "POST", body: raw.replace("6000", "6001"), headers: { [SIGNATURE_HEADER]: sig } }))).status).toBe(401);
    expect((await handler(new Request(`${base}/payment.webhook/bitcoin`, { method: "POST", body: raw }))).status).toBe(404);
  });

  it("sync: sem segredo 401; com segredo consulta cada cobrança e grava o que o PSP disse; sem resposta continua desconhecido", async () => {
    const items = [
      { charge_id: "c0000000-0000-4000-8000-000000000001", provider: "simulated", external_id: "sim-paid", reason: "expired" },
      { charge_id: "c0000000-0000-4000-8000-000000000002", provider: "simulated", external_id: null, reason: "unknown" },
      { charge_id: "c0000000-0000-4000-8000-000000000003", provider: "psp", external_id: "ch_x", reason: "unknown" },
    ];
    const psp: PaymentProviderPort = { name: "psp", configured: true, createCharge: vi.fn(), status: vi.fn(async () => null), cancel: vi.fn(), refund: vi.fn(), report: vi.fn(), verifySignature: vi.fn(), normalize: () => [] };
    const serviceRpc = vi.fn(async (fn: string, args?: Record<string, unknown>) => {
      if (fn === "payment_sync_claim") return { data: { items }, error: null };
      if (fn === "payment_sim_status") return { data: { status: "paid", amount_cents: 6000, paid_at: "2026-10-22T13:00:00Z" }, error: null };
      if (fn === "payment_sync_result") return { data: { outcome: args?.p_status === "paid" ? "entry" : args?.p_status === "failed" ? "failed" : "still_unknown" }, error: null };
      return { data: {}, error: null };
    });
    const { handler } = setup({ serviceRpc, providers: { simulated: createSimulatedPaymentProvider({ secret: SIM_SECRET, store: serviceRpc }), psp } });
    expect((await handler(new Request(`${base}/payment.sync`, { method: "POST", headers: { [SYNC_SECRET_HEADER]: "x".repeat(40) } }))).status).toBe(401);
    const res = await handler(new Request(`${base}/payment.sync`, { method: "POST", headers: { [SYNC_SECRET_HEADER]: SYNC } }));
    expect(await res.json()).toMatchObject({ data: { provider_configured: true, checked: 3, settled: 1, closed: 1, still_unknown: 1 } });
    const results = serviceRpc.mock.calls.filter((c) => c[0] === "payment_sync_result").map((c) => c[1] as Record<string, unknown>);
    expect(results.map((r) => r.p_status)).toEqual(["paid", "failed", null]);
  });
});

describe("payments · link público e simulador", () => {
  it("link: token no corpo, sem JWT; token inválido = não existe", async () => {
    const { handler } = setup();
    const res = await handler(new Request(`${base}/payment.link_view`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: "t".repeat(43) }) }));
    expect(res.status).toBe(200);
    expect((await res.json() as { data: { business_name: string } }).data.business_name).toBe("Barbearia");
    const bad = await handler(new Request(`${base}/payment.link_view`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: "curto" }) }));
    expect(ErrorEnvelope.parse(await bad.json()).error.code).toBe("NOT_FOUND");
  });

  it("sim_pay: muda o livro fictício e passa pelo webhook assinado; notify=false perde o webhook; só cobrança simulada", async () => {
    const { handler, serviceRpc } = setup();
    const body = (extra: Record<string, unknown>) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: "t".repeat(43), ...extra }) });
    const res = await handler(new Request(`${base}/payment.sim_pay`, body({})));
    expect(await res.json()).toMatchObject({ data: { status: "paid", applied: 1, duplicates: 0 } });
    expect(serviceRpc).toHaveBeenCalledWith("payment_sim_transition", { p_external_id: "sim-1", p_status: "paid" });
    expect(serviceRpc).toHaveBeenCalledWith("payment_webhook_ingest", { p_provider: "simulated", p_events: [expect.objectContaining({ kind: "charge.paid", external_id: "sim-1", external_event_id: "sim:sim-1:paid" })] });
    serviceRpc.mockClear();
    const lost = await handler(new Request(`${base}/payment.sim_pay`, body({ notify: false })));
    expect(await lost.json()).toMatchObject({ data: { status: "pending", applied: 0 } });
    expect(serviceRpc).not.toHaveBeenCalledWith("payment_webhook_ingest", expect.anything());
    const real = setup({ anonRpc: vi.fn(async () => ({ data: { charge_id: CHARGE.id, business_name: "B", description: "x", amount_cents: 1, provider: "psp", simulated: false, status: "pending", pix_code: null, checkout_url: null, expires_at: null, paid_at: null }, error: null })) });
    const refused = await real.handler(new Request(`${base}/payment.sim_pay`, body({})));
    expect(ErrorEnvelope.parse(await refused.json()).error).toMatchObject({ code: "POLICY_REJECTED", field: "provider" });
  });
});
