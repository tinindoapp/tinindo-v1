import { describe, expect, it, vi } from "vitest";
import { ErrorEnvelope } from "../_shared/contracts/index.ts";
import { FX } from "../_shared/contracts/fixtures.ts";
import { route } from "../_shared/http/rpc-handler.ts";
import { OpsQueueInput, OpsQueueOutput } from "../_shared/contracts/index.ts";
import { createServiceOpsHandler, type ServiceOpsDeps } from "./handler.ts";

const setup = (rpc: ServiceOpsDeps["rpc"]) => createServiceOpsHandler({ rpc, allowedOrigins: [] });
const post = (op: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://edge/functions/v1/service-ops/${op}`, { method: "POST", headers, body: JSON.stringify(body) });
const jwt = { Authorization: "Bearer jwt" };

describe("Edge Function service-ops", () => {
  it("fila da operação não exige negócio e não envia p_tenant_id", async () => {
    const rpc = vi.fn(async () => ({ data: { operator: { user_id: FX.users.outsider, display_name: "Op" }, operators: [], orders: [] }, error: null }));
    const res = await setup(rpc)(post("ops.queue", {}, jwt));
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("jwt", "service_ops_queue", {});
  });

  it("quem não é operador recebe 403 do banco", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { code: "PT403", message: "FORBIDDEN" } }));
    const res = await setup(rpc)(post("ops.queue", {}, jwt));
    expect(ErrorEnvelope.parse(await res.json()).error.code).toBe("FORBIDDEN");
  });

  it("rotas do negócio exigem negócio selecionado; comandos exigem chave", async () => {
    const rpc = vi.fn();
    expect((await setup(rpc)(post("plan.current", {}, jwt))).status).toBe(400);
    const body = { order_id: "71000000-0000-4000-8000-000000000001", minutes: 30, kind: "human" };
    expect((await setup(rpc)(post("ops.log_work", body, { ...jwt, "X-Tinindo-Tenant": FX.tenants.A }))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("minutos acima da franquia: 429 QUOTA_EXCEEDED", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { code: "PT429", message: "QUOTA_EXCEEDED", hint: "minutes" } }));
    const res = await setup(rpc)(post("ops.log_work", { order_id: "71000000-0000-4000-8000-000000000001", minutes: 30, kind: "human" },
      { ...jwt, "X-Tinindo-Tenant": FX.tenants.A, "Idempotency-Key": "chave-minutos-0000001" }));
    expect(res.status).toBe(429);
    expect((rpc.mock.calls[0] as unknown as [string, string, Record<string, unknown>])[2]).toMatchObject({ p_reprocess: false });
  });

  it("acesso delegado: escopo fora da lista é recusado antes do banco", async () => {
    const rpc = vi.fn();
    const res = await setup(rpc)(post("access.grant", { order_id: "71000000-0000-4000-8000-000000000001", scopes: ["finance"],
      expires_at: "2026-10-25T12:00:00Z", justification: "x" }, { ...jwt, "X-Tinindo-Tenant": FX.tenants.A, "Idempotency-Key": "chave-acesso-00000001" }));
    expect(res.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("comando sem negócio é proibido na definição da rota", () => {
    expect(() => route({ rpc: "x", input: OpsQueueInput, output: OpsQueueOutput, command: true, tenant: false, args: () => ({}) })).toThrow();
  });
});
