import { describe, expect, it, vi } from "vitest";
import { ErrorEnvelope, PaymentEntry, successEnvelope } from "../_shared/contracts/index.ts";
import { FX } from "../_shared/contracts/fixtures.ts";
import { createFinanceHandler, type FinanceDeps } from "./handler.ts";

const IDEM = "idem-teste-caixa-00001";
const RECEIVABLE = "62000000-0000-4000-8000-000000000001";
const PAYMENT = "63000000-0000-4000-8000-000000000001";

function setup(rpc: FinanceDeps["rpc"]) {
  return createFinanceHandler({ rpc, allowedOrigins: [], clock: { now: () => new Date("2026-10-20T12:00:00Z") } });
}
const post = (op: string, body: unknown, extra: Record<string, string> = { "Idempotency-Key": IDEM }) =>
  new Request(`http://edge/functions/v1/finance/${op}`, {
    method: "POST",
    headers: { Authorization: "Bearer user-jwt", "X-Tinindo-Tenant": FX.tenants.A, ...extra },
    body: JSON.stringify(body),
  });
const payment = { receivable_id: RECEIVABLE, amount_cents: 2500, method: "pix", received_at: "2026-10-20T11:00:00Z" };

describe("Edge Function finance", () => {
  it("recebimento exige Idempotency-Key e valor positivo antes do banco", async () => {
    const rpc = vi.fn();
    expect((await setup(rpc)(post("finance.record_payment", payment, {}))).status).toBe(400);
    const zero = await setup(rpc)(post("finance.record_payment", { ...payment, amount_cents: 0 }));
    expect(ErrorEnvelope.parse(await zero.json()).error.field).toBe("amount_cents");
    const float = await setup(rpc)(post("finance.record_payment", { ...payment, amount_cents: 25.5 }));
    expect(float.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("recebimento chama a RPC com centavos inteiros e devolve o PaymentEntry do contrato", async () => {
    const body = { id: PAYMENT, tenant_id: FX.tenants.A, customer_id: null, amount_cents: 2500, method: "pix",
      source: "manual", received_at: "2026-10-20T11:00:00Z", reversal_of: null, receivable_id: RECEIVABLE, reversed: false };
    const rpc = vi.fn(async () => ({ data: { status_code: 201, body }, error: null }));
    const res = await setup(rpc)(post("finance.record_payment", payment));
    expect(res.status).toBe(201);
    expect(successEnvelope(PaymentEntry).parse(await res.json()).data.source).toBe("manual");
    const [, fn, args] = rpc.mock.calls[0] as unknown as [string, string, Record<string, unknown>];
    expect(fn).toBe("finance_record_payment");
    expect(args).toMatchObject({ p_tenant_id: FX.tenants.A, p_receivable_id: RECEIVABLE, p_amount_cents: 2500, p_idem_key: IDEM });
  });

  it("excesso sobre o saldo volta como 422 com o campo", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { code: "PT422", message: "POLICY_REJECTED", hint: "amount_cents" } }));
    const res = await setup(rpc)(post("finance.record_payment", payment));
    expect(res.status).toBe(422);
    expect(ErrorEnvelope.parse(await res.json()).error.field).toBe("amount_cents");
  });

  it("resumo é consulta (sem chave) e recusa resposta que pareça lucro negativo", async () => {
    const rpc = vi.fn(async () => ({ data: { period: { starts_at: "2026-10-01T03:00:00Z", ends_at: "2026-11-01T03:00:00Z" },
      received_cents: -1, spent_cents: 0, receivable_open_cents: 0, records_count: 0, as_of: "2026-10-20T12:00:00Z", coverage_note: "x" }, error: null }));
    const res = await setup(rpc)(post("finance.summary", {
      period: { starts_at: "2026-10-01T03:00:00Z", ends_at: "2026-11-01T03:00:00Z" }, timezone: "America/Sao_Paulo",
    }, {}));
    expect(res.status).toBe(500);
  });
});
