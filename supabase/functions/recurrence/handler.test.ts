import { describe, expect, it, vi } from "vitest";
import { ErrorEnvelope } from "../_shared/contracts/index.ts";
import { FX } from "../_shared/contracts/fixtures.ts";
import { createRecurrenceHandler, type RecurrenceDeps } from "./handler.ts";

const setup = (rpc: RecurrenceDeps["rpc"]) => createRecurrenceHandler({ rpc, allowedOrigins: [] });
const post = (op: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://edge/functions/v1/recurrence/${op}`, { method: "POST", headers, body: JSON.stringify(body) });
const owner = { Authorization: "Bearer jwt", "X-Tinindo-Tenant": FX.tenants.A };
const key = { ...owner, "Idempotency-Key": "chave-recorrencia-00001" };

describe("Edge Function recurrence", () => {
  it("plano: ciclo fora de 7/14/30 e preço zero são recusados antes do banco; criar passa plan_id null e padrões", async () => {
    const rpc = vi.fn(async () => ({ data: { status_code: 201, body: { plan: { id: FX.services.corteA, service_id: FX.services.corteA, service_name: "Corte", name: "Corte mensal", sessions_per_cycle: 4, cycle_days: 30, price_cents: 20000, active: true, subscribers: 0, created_at: "2026-10-22T12:00:00Z", version: 1 } } }, error: null }));
    expect((await setup(rpc)(post("recurrence.plan_save", { service_id: FX.services.corteA, name: "x", sessions_per_cycle: 4, cycle_days: 10, price_cents: 1 }, key))).status).toBe(400);
    expect((await setup(rpc)(post("recurrence.plan_save", { service_id: FX.services.corteA, name: "x", sessions_per_cycle: 4, price_cents: 0 }, key))).status).toBe(400);
    const res = await setup(rpc)(post("recurrence.plan_save", { service_id: FX.services.corteA, name: "Corte mensal", sessions_per_cycle: 4, price_cents: 20000 }, key));
    expect(res.status).toBe(201);
    expect(rpc).toHaveBeenCalledWith("jwt", "recurrence_plan_save", expect.objectContaining({ p_plan_id: null, p_expected_version: null, p_cycle_days: 30, p_active: true, p_price_cents: 20000 }));
  });

  it("adesão e cancelamento são comandos: exigem chave; cancelar manda fim do ciclo por padrão", async () => {
    const rpc = vi.fn(async () => ({ data: { status_code: 200, body: {} }, error: null }));
    const noKey = await setup(rpc)(post("recurrence.subscribe", { plan_id: FX.services.corteA, customer_id: FX.customers.abInA }, owner));
    expect(ErrorEnvelope.parse(await noKey.json()).error.field).toBe("idempotency_key");
    await setup(rpc)(post("recurrence.cancel", { subscription_id: FX.services.corteA, expected_version: 2 }, key));
    expect(rpc).toHaveBeenCalledWith("jwt", "recurrence_cancel", expect.objectContaining({ p_subscription_id: FX.services.corteA, p_expected_version: 2, p_at_period_end: true, p_reason: null }));
  });

  it("lista: resposta fora do contrato vira 500", async () => {
    const rpc = vi.fn(async () => ({ data: { subscriptions: [{ id: "x" }] }, error: null }));
    expect((await setup(rpc)(post("recurrence.subscriptions", {}, owner))).status).toBe(500);
    expect(rpc).toHaveBeenCalledWith("jwt", "recurrence_list", { p_tenant_id: FX.tenants.A });
  });
});
