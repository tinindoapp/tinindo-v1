import { describe, expect, it, vi } from "vitest";
import { ErrorEnvelope } from "../_shared/contracts/index.ts";
import { FX } from "../_shared/contracts/fixtures.ts";
import { createLifecycleHandler, type LifecycleDeps } from "./handler.ts";

const setup = (rpc: LifecycleDeps["rpc"]) => createLifecycleHandler({ rpc, allowedOrigins: [] });
const post = (op: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://edge/functions/v1/lifecycle/${op}`, { method: "POST", headers, body: JSON.stringify(body) });
const owner = { Authorization: "Bearer jwt", "X-Tinindo-Tenant": FX.tenants.A };
const key = { ...owner, "Idempotency-Key": "chave-relacionamento-0001" };

describe("Edge Function lifecycle", () => {
  it("configuração: horas fora da lista são recusadas antes do banco; salvar passa versão e só os campos enviados", async () => {
    const rpc = vi.fn(async () => ({ data: { status_code: 200, body: { settings: { enabled: true, confirmation: true, reminder_hours: [24], quote_followup_days: 2, receivable_reminder: true, reactivation_days: 60, daily_budget: 10, version: 1 }, sent_today: 0 } }, error: null }));
    expect((await setup(rpc)(post("lifecycle.settings_save", { settings: { reminder_hours: [100] }, expected_version: 0 }, key))).status).toBe(400);
    const res = await setup(rpc)(post("lifecycle.settings_save", { settings: { reminder_hours: [24], daily_budget: 10 }, expected_version: 0 }, key));
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("jwt", "lifecycle_settings_save", expect.objectContaining({ p_tenant_id: FX.tenants.A, p_settings: { reminder_hours: [24], daily_budget: 10 }, p_expected_version: 0 }));
  });

  it("aprovar campanha é comando: exige chave e cita o público visto", async () => {
    const rpc = vi.fn();
    const res = await setup(rpc)(post("lifecycle.campaign_approve", { audience_hash: "a".repeat(64), max_sends: 10 }, owner));
    expect(ErrorEnvelope.parse(await res.json()).error.field).toBe("idempotency_key");
    expect(rpc).not.toHaveBeenCalled();
    const bad = await setup(rpc)(post("lifecycle.campaign_approve", { audience_hash: "curto", max_sends: 10 }, key));
    expect(ErrorEnvelope.parse(await bad.json()).error.field).toBe("audience_hash");
  });

  it("fila: filtro por estado vai à RPC; resposta fora do contrato vira 500", async () => {
    const rpc = vi.fn(async () => ({ data: { steps: [{ id: "x" }], counts: {} }, error: null }));
    const res = await setup(rpc)(post("lifecycle.steps", { status: "manual" }, owner));
    expect(res.status).toBe(500);
    expect(rpc).toHaveBeenCalledWith("jwt", "lifecycle_steps_list", { p_tenant_id: FX.tenants.A, p_status: "manual" });
  });
});
