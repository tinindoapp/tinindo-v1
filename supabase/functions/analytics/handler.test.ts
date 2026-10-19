import { describe, expect, it, vi } from "vitest";
import { ErrorEnvelope } from "../_shared/contracts/index.ts";
import { FX } from "../_shared/contracts/fixtures.ts";
import { createAnalyticsHandler, type AnalyticsDeps } from "./handler.ts";

const setup = (rpc: AnalyticsDeps["rpc"]) => createAnalyticsHandler({ rpc, allowedOrigins: [] });
const post = (op: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://edge/functions/v1/analytics/${op}`, { method: "POST", headers, body: JSON.stringify(body) });
const owner = { Authorization: "Bearer jwt", "X-Tinindo-Tenant": FX.tenants.A };
const period = { starts_at: "2026-10-12T03:00:00Z", ends_at: "2026-10-17T03:00:00Z" };

describe("Edge Function analytics", () => {
  it("indicadores: resposta fora do contrato (causalidade afirmada) vira 500, nunca chega à tela", async () => {
    const rpc = vi.fn(async () => ({ data: { period, timezone: "America/Sao_Paulo", as_of: "2026-10-20T12:00:00Z", metrics: [], coverage: [],
      baseline: null, comparison: null, causality: "established", comparison_note: "x" }, error: null }));
    const res = await setup(rpc)(post("analytics.metrics", { period }, owner));
    expect(res.status).toBe(500);
    expect(rpc).toHaveBeenCalledWith("jwt", "analytics_metrics", { p_tenant_id: FX.tenants.A, p_from: period.starts_at, p_to: period.ends_at, p_baseline_id: null });
  });

  it("baseline é comando: exige chave", async () => {
    const rpc = vi.fn();
    const res = await setup(rpc)(post("analytics.baseline_create", { label: "Antes", period }, owner));
    expect(ErrorEnvelope.parse(await res.json()).error.field).toBe("idempotency_key");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("custo por cliente não exige negócio; custo-hora negativo é recusado antes do banco", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { code: "PT403", message: "FORBIDDEN" } }));
    expect((await setup(rpc)(post("analytics.cost_to_serve", { period, hourly_cost_cents: -1 }, { Authorization: "Bearer jwt" }))).status).toBe(400);
    const res = await setup(rpc)(post("analytics.cost_to_serve", { period, hourly_cost_cents: 6000 }, { Authorization: "Bearer jwt" }));
    expect(res.status).toBe(403);
    expect(rpc).toHaveBeenCalledWith("jwt", "analytics_cost_to_serve", { p_from: period.starts_at, p_to: period.ends_at, p_hourly_cost_cents: 6000 });
  });
});
