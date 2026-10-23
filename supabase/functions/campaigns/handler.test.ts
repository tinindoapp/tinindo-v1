import { describe, expect, it, vi } from "vitest";
import { ErrorEnvelope } from "../_shared/contracts/index.ts";
import { FX } from "../_shared/contracts/fixtures.ts";
import { type CampaignsDeps, createCampaignsHandler } from "./handler.ts";

const setup = (rpc: CampaignsDeps["rpc"]) => createCampaignsHandler({ rpc, allowedOrigins: [] });
const post = (op: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://edge/functions/v1/campaigns/${op}`, { method: "POST", headers, body: JSON.stringify(body) });
const owner = { Authorization: "Bearer jwt", "X-Tinindo-Tenant": FX.tenants.A };
const key = { ...owner, "Idempotency-Key": "chave-campanha-000001" };
const HASH = "a".repeat(64);
const campaign = {
  id: FX.tenants.B, name: "Volta", segment: { kind: "inactive_days", days: 30 }, audience_count: 10, control_pct: 20, control_count: 2, treatment_count: 8,
  max_sends: 100, spend_cap_cents: null, estimated_cost_cents: 0, offer: { kind: "none" }, offer_text: "um horário reservado para você", window_days: 14, status: "running",
  starts_at: "2026-10-22T12:00:00Z", ends_at: "2026-11-05T12:00:00Z", closed_at: null, created_at: "2026-10-22T12:00:00Z", version: 1,
  result: { design: "randomized_control", final: false, window: { starts_at: "2026-10-22T12:00:00Z", ends_at: "2026-11-05T12:00:00Z" },
    arms: { treatment: { n: 8, converted: 0, rate: 0, ci: [0, 0.3244], revenue_cents: 0, sent: 0, manual: 8, skipped: 0, pending: 0 }, control: { n: 2, converted: 0, rate: 0, ci: [0, 0.6576], revenue_cents: 0, sent: 0, manual: 0, skipped: 0, pending: 0 } },
    difference: null, verdict: "inconclusive" },
};

describe("Edge Function campaigns", () => {
  it("aprovar é comando: exige chave; segmento e oferta inválidos caem antes do banco; padrões de controle e janela", async () => {
    const rpc = vi.fn(async () => ({ data: { status_code: 201, body: { campaign } }, error: null }));
    const noKey = await setup(rpc)(post("campaign.approve", { name: "Volta", segment: { kind: "inactive_days", days: 30 }, audience_hash: HASH, max_sends: 100 }, owner));
    expect(ErrorEnvelope.parse(await noKey.json()).error.field).toBe("idempotency_key");
    expect((await setup(rpc)(post("campaign.approve", { name: "Volta", segment: { kind: "inactive_days", days: 3 }, audience_hash: HASH, max_sends: 100 }, key))).status).toBe(400);
    expect((await setup(rpc)(post("campaign.approve", { name: "Volta", segment: { kind: "marketing_all" }, audience_hash: HASH, max_sends: 100, offer: { kind: "discount_pct", pct: 90 } }, key))).status).toBe(400);
    expect((await setup(rpc)(post("campaign.approve", { name: "Volta", segment: { kind: "marketing_all" }, audience_hash: HASH, max_sends: 100, control_pct: 80 }, key))).status).toBe(400);
    const res = await setup(rpc)(post("campaign.approve", { name: "Volta", segment: { kind: "inactive_days", days: 30 }, audience_hash: HASH, max_sends: 100 }, key));
    expect(res.status).toBe(201);
    expect(rpc).toHaveBeenCalledWith("jwt", "campaign_approve", expect.objectContaining({ p_control_pct: 20, p_window_days: 14, p_spend_cap_cents: null, p_offer: { kind: "none" }, p_max_sends: 100 }));
  });

  it("prévia passa o segmento; resposta fora do contrato (veredito inventado) vira 500", async () => {
    const rpc = vi.fn(async () => ({ data: { segment: { kind: "credit_remaining" }, customers: [], audience_hash: HASH, audience_count: 0 }, error: null }));
    expect((await setup(rpc)(post("campaign.preview", { segment: { kind: "credit_remaining" } }, owner))).status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("jwt", "campaign_preview", { p_tenant_id: FX.tenants.A, p_segment: { kind: "credit_remaining" } });
    const bad = vi.fn(async () => ({ data: { campaigns: [{ ...campaign, result: { ...campaign.result, verdict: "caused_growth" } }] }, error: null }));
    expect((await setup(bad)(post("campaign.list", {}, owner))).status).toBe(500);
  });

  it("cancelar exige versão; erro do banco mapeado", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { code: "PT409", message: "STALE_VERSION", hint: null } }));
    const res = await setup(rpc)(post("campaign.cancel", { campaign_id: FX.tenants.B, expected_version: 1 }, key));
    expect(res.status).toBe(409);
    expect(ErrorEnvelope.parse(await res.json()).error.code).toBe("STALE_VERSION");
    expect((await setup(rpc)(post("campaign.cancel", { campaign_id: FX.tenants.B }, key))).status).toBe(400);
  });
});
