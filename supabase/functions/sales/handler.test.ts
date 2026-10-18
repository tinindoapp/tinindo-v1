import { describe, expect, it, vi } from "vitest";
import { ErrorEnvelope } from "../_shared/contracts/index.ts";
import { FX } from "../_shared/contracts/fixtures.ts";
import { createSalesHandler, type SalesDeps } from "./handler.ts";

const TOKEN = "a".repeat(43);
const HASH = "f".repeat(64);
const setup = (rpc: SalesDeps["rpc"]) => {
  const log = vi.fn();
  return { handler: createSalesHandler({ rpc, allowedOrigins: [], log }), log };
};
const post = (op: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://edge/functions/v1/sales/${op}`, { method: "POST", headers, body: JSON.stringify(body) });
const owner = { Authorization: "Bearer jwt", "X-Tinindo-Tenant": FX.tenants.A };

const version = {
  version_no: 2, title: "Corte e barba", total_cents: 9500, currency: "BRL", valid_until: "2026-10-27T12:00:00Z",
  items: [{ service_id: FX.services.corteA, description: "Corte", quantity: 1, unit_price_cents: 6000, line_total_cents: 6000 },
    { service_id: FX.services.barbaA, description: "Barba", quantity: 1, unit_price_cents: 3500, line_total_cents: 3500 }],
  slot: null, notes: null, snapshot_hash: HASH, created_at: "2026-10-20T12:00:00Z",
};

describe("Edge Function sales · link do orçamento", () => {
  it("ver é anônimo, não exige chave e não manda JWT", async () => {
    const rpc = vi.fn(async () => ({ data: { ...version, business_name: "Barbearia", timezone: "America/Sao_Paulo",
      status: "sent", slot_service_name: null }, error: null }));
    const res = await setup(rpc).handler(post("quote.view", { token: TOKEN }));
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith(null, "sales_quote_view", { p_token: TOKEN });
  });

  it("aceitar exige Idempotency-Key, versão e hash; token malformado = inexistente (404), sem consultar", async () => {
    const rpc = vi.fn();
    expect((await setup(rpc).handler(post("quote.accept", { token: TOKEN, version_no: 2, snapshot_hash: HASH }))).status).toBe(400);
    const key = { "Idempotency-Key": "chave-aceite-00000001" };
    const bad = await setup(rpc).handler(post("quote.accept", { token: "curto", version_no: 2, snapshot_hash: HASH }, key));
    expect(ErrorEnvelope.parse(await bad.json()).error.code).toBe("NOT_FOUND");
    const noHash = await setup(rpc).handler(post("quote.accept", { token: TOKEN, version_no: 2 }, key));
    expect(noHash.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("aceite passa versão e hash à RPC; versão desatualizada volta 409 e o log não leva o token", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { code: "PT409", message: "STALE_VERSION" } }));
    const { handler, log } = setup(rpc);
    const res = await handler(post("quote.accept", { token: TOKEN, version_no: 1, snapshot_hash: HASH },
      { "Idempotency-Key": "chave-aceite-00000002" }));
    expect(res.status).toBe(409);
    expect(ErrorEnvelope.parse(await res.json()).error.code).toBe("STALE_VERSION");
    expect(rpc).toHaveBeenCalledWith(null, "sales_quote_accept", { p_token: TOKEN, p_version_no: 1, p_snapshot_hash: HASH });
    expect(JSON.stringify(log.mock.calls)).not.toContain(TOKEN);
  });

  it("sem vaga no aceite: 409 SLOT_CONFLICT", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { code: "PT409", message: "SLOT_CONFLICT" } }));
    const res = await setup(rpc).handler(post("quote.accept", { token: TOKEN, version_no: 1, snapshot_hash: HASH },
      { "Idempotency-Key": "chave-aceite-00000003" }));
    expect(ErrorEnvelope.parse(await res.json()).error.code).toBe("SLOT_CONFLICT");
  });
});

describe("Edge Function sales · dono", () => {
  it("criar exige chave; itens vão normalizados e o total nunca é enviado", async () => {
    const quote = { id: "71000000-0000-4000-8000-000000000001", customer_id: FX.customers.abInA, status: "draft", current_version: 1,
      link_active: false, sent_at: null, decided_at: null, decided_version: null, booking_id: null, version: 1,
      created_at: "2026-10-20T12:00:00Z", current: { ...version, version_no: 1 } };
    const rpc = vi.fn(async () => ({ data: { status_code: 201, body: { quote } }, error: null }));
    const body = { customer_id: FX.customers.abInA, title: "Corte", valid_until: "2026-10-27T12:00:00Z",
      items: [{ description: "Corte", quantity: 1, unit_price_cents: 6000, line_total_cents: 1 }] };
    expect((await setup(rpc).handler(post("quote.create", body, owner))).status).toBe(400);
    const res = await setup(rpc).handler(post("quote.create", body, { ...owner, "Idempotency-Key": "chave-criar-000000001" }));
    expect(res.status).toBe(201);
    const args = (rpc.mock.calls[0] as unknown as [string, string, Record<string, unknown>])[2];
    expect(args.p_items).toEqual([{ service_id: null, description: "Corte", quantity: 1, unit_price_cents: 6000 }]);
    expect(args).not.toHaveProperty("p_total_cents");
    expect(args.p_slot_service_id).toBeNull();
  });

  it("sem JWT: 401 antes de consultar", async () => {
    const rpc = vi.fn();
    const res = await setup(rpc).handler(post("quote.list", {}, { "X-Tinindo-Tenant": FX.tenants.A }));
    expect(res.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });
});
