import { describe, expect, it, vi } from "vitest";
import { ErrorEnvelope } from "../_shared/contracts/index.ts";
import { FX } from "../_shared/contracts/fixtures.ts";
import { createMaterialsHandler, type MaterialsDeps } from "./handler.ts";

const setup = (rpc: MaterialsDeps["rpc"]) => createMaterialsHandler({ rpc, allowedOrigins: [] });
const post = (op: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://edge/functions/v1/materials/${op}`, { method: "POST", headers, body: JSON.stringify(body) });
const owner = { Authorization: "Bearer jwt", "X-Tinindo-Tenant": FX.tenants.A };
const key = { ...owner, "Idempotency-Key": "chave-materiais-00001" };
const ITEM = FX.services.corteA;

describe("Edge Function materials", () => {
  it("compra: item repetido, quantidade com 4 casas ou zero são recusados antes do banco; despesa no Caixa por padrão", async () => {
    const rpc = vi.fn(async () => ({ data: { status_code: 201, body: {} }, error: null }));
    const at = "2026-10-27T12:00:00Z";
    const line = { item_id: ITEM, quantity: 10, total_cents: 500 };
    expect((await setup(rpc)(post("materials.purchase", { purchased_at: at, lines: [line, line] }, key))).status).toBe(400);
    expect((await setup(rpc)(post("materials.purchase", { purchased_at: at, lines: [{ ...line, quantity: 0.0001 }] }, key))).status).toBe(400);
    expect((await setup(rpc)(post("materials.purchase", { purchased_at: at, lines: [{ ...line, quantity: 0 }] }, key))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
    await setup(rpc)(post("materials.purchase", { purchased_at: at, lines: [{ ...line, quantity: 2.5 }] }, key));
    expect(rpc).toHaveBeenCalledWith("jwt", "materials_purchase", expect.objectContaining({ p_record_expense: true, p_supplier: null, p_lines: [{ ...line, quantity: 2.5 }] }));
  });

  it("consumo: sem linhas vai pela ficha (null); comando exige chave; falta de estoque vira POLICY_REJECTED/stock", async () => {
    const noKey = await setup(vi.fn())(post("materials.consume", { booking_id: ITEM }, owner));
    expect(ErrorEnvelope.parse(await noKey.json()).error.field).toBe("idempotency_key");
    const rpc = vi.fn(async () => ({ data: null, error: { code: "PT422", message: "POLICY_REJECTED", hint: "stock" } }));
    const res = await setup(rpc)(post("materials.consume", { booking_id: ITEM }, key));
    expect(rpc).toHaveBeenCalledWith("jwt", "materials_consume", expect.objectContaining({ p_booking_id: ITEM, p_lines: null }));
    expect(res.status).toBe(422);
    expect(ErrorEnvelope.parse(await res.json()).error).toMatchObject({ code: "POLICY_REJECTED", field: "stock" });
  });

  it("ajuste exige motivo; margem fora do contrato vira 500", async () => {
    const rpc = vi.fn(async () => ({ data: { services: [{ service_id: "x" }] }, error: null }));
    expect((await setup(rpc)(post("materials.adjust", { item_id: ITEM, expected_version: 1, counted: 3, reason: " " }, key))).status).toBe(400);
    const res = await setup(rpc)(post("materials.margin", { period: { starts_at: "2026-10-01T03:00:00Z", ends_at: "2026-11-01T03:00:00Z" } }, owner));
    expect(res.status).toBe(500);
  });
});
