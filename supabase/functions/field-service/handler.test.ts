import { describe, expect, it, vi } from "vitest";
import { ErrorEnvelope } from "../_shared/contracts/index.ts";
import { FX } from "../_shared/contracts/fixtures.ts";
import { createFieldServiceHandler, type FieldServiceDeps } from "./handler.ts";

const setup = (rpc: FieldServiceDeps["rpc"]) => createFieldServiceHandler({ rpc, allowedOrigins: [] });
const post = (op: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://edge/functions/v1/field-service/${op}`, { method: "POST", headers, body: JSON.stringify(body) });
const owner = { Authorization: "Bearer jwt", "X-Tinindo-Tenant": FX.tenants.A };
const key = { ...owner, "Idempotency-Key": "chave-domicilio-0001" };
const ID = FX.services.corteA;

describe("Edge Function field-service", () => {
  it("zona: CEP fora de 5 dígitos ou repetido recusado antes do banco; padrões chegam à RPC", async () => {
    const rpc = vi.fn(async () => ({ data: { status_code: 201, body: {} }, error: null }));
    expect((await setup(rpc)(post("field.zone_save", { name: "Centro", cep_prefixes: ["0100"], distance_km: 2, travel_from_base_min: 20 }, key))).status).toBe(400);
    expect((await setup(rpc)(post("field.zone_save", { name: "Centro", cep_prefixes: ["01000", "01000"], distance_km: 2, travel_from_base_min: 20 }, key))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
    await setup(rpc)(post("field.zone_save", { name: "Centro", distance_km: 2, travel_from_base_min: 20 }, key));
    expect(rpc).toHaveBeenCalledWith("jwt", "field_zone_save", expect.objectContaining({ p_zone_id: null, p_cep_prefixes: [], p_active: true }));
  });

  it("visita exige chave; deslocamento que não cabe vira SLOT_CONFLICT/travel", async () => {
    const noKey = await setup(vi.fn())(post("field.visit_attach", { booking_id: ID, zone_id: ID }, owner));
    expect(ErrorEnvelope.parse(await noKey.json()).error.field).toBe("idempotency_key");
    const rpc = vi.fn(async () => ({ data: null, error: { code: "PT409", message: "SLOT_CONFLICT", hint: "travel" } }));
    const res = await setup(rpc)(post("field.visit_attach", { booking_id: ID, zone_id: ID }, key));
    expect(rpc).toHaveBeenCalledWith("jwt", "field_visit_attach", expect.objectContaining({ p_cep5: null }));
    expect(ErrorEnvelope.parse(await res.json()).error).toMatchObject({ code: "SLOT_CONFLICT", field: "travel" });
  });

  it("tempo entre a mesma zona é recusado; roteiro fora do contrato vira 500", async () => {
    const rpc = vi.fn(async () => ({ data: { stops: [{ visit_id: "x" }] }, error: null }));
    expect((await setup(rpc)(post("field.travel_save", { zone_a: ID, zone_b: ID, minutes: 10 }, key))).status).toBe(400);
    expect((await setup(rpc)(post("field.route", { day: "2026-11-05" }, owner))).status).toBe(500);
    expect(rpc).toHaveBeenCalledWith("jwt", "field_route", { p_tenant_id: FX.tenants.A, p_day: "2026-11-05" });
  });
});
