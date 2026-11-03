import { describe, expect, it, vi } from "vitest";
import { ErrorEnvelope } from "../_shared/contracts/index.ts";
import { FX } from "../_shared/contracts/fixtures.ts";
import { createFinanceAdvancedHandler, type FinanceAdvancedDeps } from "./handler.ts";

const setup = (rpc: FinanceAdvancedDeps["rpc"]) => createFinanceAdvancedHandler({ rpc, allowedOrigins: [] });
const post = (op: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://edge/functions/v1/finance-advanced/${op}`, { method: "POST", headers, body: JSON.stringify(body) });
const owner = { Authorization: "Bearer jwt", "X-Tinindo-Tenant": FX.tenants.A };
const key = { ...owner, "Idempotency-Key": "chave-contas-000001" };
const ID = FX.services.corteA;

describe("Edge Function finance-advanced", () => {
  it("conta: valor zero ou data inválida recusados antes do banco; nova conta única por padrão", async () => {
    const rpc = vi.fn(async () => ({ data: { status_code: 201, body: {} }, error: null }));
    expect((await setup(rpc)(post("accounts.payable_save", { description: "Aluguel", amount_cents: 0, due_on: "2026-11-10" }, key))).status).toBe(400);
    expect((await setup(rpc)(post("accounts.payable_save", { description: "Aluguel", amount_cents: 1000, due_on: "10/11/2026" }, key))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
    await setup(rpc)(post("accounts.payable_save", { description: "Aluguel", amount_cents: 150000, due_on: "2026-11-10" }, key));
    expect(rpc).toHaveBeenCalledWith("jwt", "accounts_payable_save", expect.objectContaining({ p_payable_id: null, p_monthly: false, p_base_category: "other", p_category_id: null }));
  });

  it("pagar exige chave e versão; conta já paga vira POLICY_REJECTED/paid", async () => {
    const noKey = await setup(vi.fn())(post("accounts.payable_pay", { payable_id: ID, expected_version: 1, paid_at: "2026-11-03T12:00:00Z" }, owner));
    expect(ErrorEnvelope.parse(await noKey.json()).error.field).toBe("idempotency_key");
    const rpc = vi.fn(async () => ({ data: null, error: { code: "PT422", message: "POLICY_REJECTED", hint: "paid" } }));
    const res = await setup(rpc)(post("accounts.payable_pay", { payable_id: ID, expected_version: 2, paid_at: "2026-11-03T12:00:00Z" }, key));
    expect(res.status).toBe(422);
    expect(ErrorEnvelope.parse(await res.json()).error).toMatchObject({ code: "POLICY_REJECTED", field: "paid" });
  });

  it("demonstrativo: mês AAAA-MM vira o primeiro dia; fora do contrato vira 500", async () => {
    const rpc = vi.fn(async () => ({ data: { basis: "accrual" }, error: null }));
    expect((await setup(rpc)(post("accounts.statement", { month: "2026-13" }, owner))).status).toBe(400);
    expect((await setup(rpc)(post("accounts.statement", { month: "2026-11" }, owner))).status).toBe(500);
    expect(rpc).toHaveBeenCalledWith("jwt", "accounts_statement", { p_tenant_id: FX.tenants.A, p_month: "2026-11-01" });
  });
});
