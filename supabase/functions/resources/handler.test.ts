import { describe, expect, it, vi } from "vitest";
import { ErrorEnvelope } from "../_shared/contracts/index.ts";
import { FX } from "../_shared/contracts/fixtures.ts";
import { createResourcesHandler, type ResourcesDeps } from "./handler.ts";

const setup = (rpc: ResourcesDeps["rpc"]) => createResourcesHandler({ rpc, allowedOrigins: [] });
const post = (op: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://edge/functions/v1/resources/${op}`, { method: "POST", headers, body: JSON.stringify(body) });
const owner = { Authorization: "Bearer jwt", "X-Tinindo-Tenant": FX.tenants.A };
const key = { ...owner, "Idempotency-Key": "chave-equipe-0000001" };
const ID = FX.services.corteA;

describe("Edge Function resources", () => {
  it("reserva composta: recurso repetido ou mais de 4 recursos são recusados antes do banco; padrões chegam à RPC", async () => {
    const rpc = vi.fn(async () => ({ data: { status_code: 201, body: {} }, error: null }));
    const base = { service_id: ID, professional_id: ID, starts_at: "2026-11-02T13:00:00Z" };
    expect((await setup(rpc)(post("resources.booking_create", { ...base, resource_ids: [ID, ID] }, key))).status).toBe(400);
    expect((await setup(rpc)(post("resources.booking_create", { ...base, resource_ids: [FX.customers.abInA, FX.customers.guestInA, FX.services.barbaA, FX.tenants.A, FX.tenants.B] }, key))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
    await setup(rpc)(post("resources.booking_create", base, key));
    expect(rpc).toHaveBeenCalledWith("jwt", "resources_booking_create", expect.objectContaining({ p_tenant_id: FX.tenants.A, p_customer_id: null, p_resource_ids: [], p_starts_at: base.starts_at }));
  });

  it("comandos exigem Idempotency-Key; o conflito do banco vira SLOT_CONFLICT com o tipo do recurso", async () => {
    const noKey = await setup(vi.fn())(post("resources.save", { kind: "room", name: "Sala 1" }, owner));
    expect(ErrorEnvelope.parse(await noKey.json()).error.field).toBe("idempotency_key");
    const rpc = vi.fn(async () => ({ data: null, error: { code: "PT409", message: "SLOT_CONFLICT", hint: "chair" } }));
    const res = await setup(rpc)(post("resources.booking_create", { service_id: ID, professional_id: ID, starts_at: "2026-11-02T13:00:00Z" }, key));
    expect(res.status).toBe(409);
    expect(ErrorEnvelope.parse(await res.json()).error).toMatchObject({ code: "SLOT_CONFLICT", field: "chair" });
  });

  it("comissão fora de 0–10000 é recusada; lista fora do contrato vira 500", async () => {
    const rpc = vi.fn(async () => ({ data: { resources: [{ id: "x" }] }, error: null }));
    expect((await setup(rpc)(post("resources.save", { kind: "professional", name: "Bia", commission_bps: 10001 }, key))).status).toBe(400);
    expect((await setup(rpc)(post("resources.list", {}, owner))).status).toBe(500);
    expect(rpc).toHaveBeenCalledWith("jwt", "resources_list", { p_tenant_id: FX.tenants.A });
  });
});
