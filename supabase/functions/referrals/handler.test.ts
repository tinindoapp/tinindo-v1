import { describe, expect, it, vi } from "vitest";
import { ErrorEnvelope } from "../_shared/contracts/index.ts";
import { FX } from "../_shared/contracts/fixtures.ts";
import { createReferralsHandler, type ReferralsDeps } from "./handler.ts";

const setup = (rpc: ReferralsDeps["rpc"]) => createReferralsHandler({ rpc, allowedOrigins: [] });
const post = (op: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://edge/functions/v1/referrals/${op}`, { method: "POST", headers, body: JSON.stringify(body) });
const owner = { Authorization: "Bearer jwt", "X-Tinindo-Tenant": FX.tenants.A };
const dashboard = {
  rules: { min_customers: 3, min_completed_bookings: 2, window_days: 60, reward_questions: 50, monthly_cap: 10 },
  invites: [{ referral_id: FX.tenants.B, invitee_name: "Colega", invitee_category: null, created_at: "2026-10-22T12:00:00Z", expires_at: "2026-11-21T12:00:00Z", state: "claimed", claimed_at: "2026-10-22T13:00:00Z",
    activation: { status: "awaiting_activity", block_reason: null, checks: { customers: 1, completed_bookings: 0 }, eligible_at: null, rewarded_at: null }, reward: null }],
  summary: { invites: 1, claimed: 1, rewarded: 0, rewarded_this_month: 0, bonus_this_month: null, agent_limit: null, agent_used: null },
};

describe("Edge Function referrals", () => {
  it("painel: leitura do dono, só p_tenant_id; sem tenant selecionado é 400", async () => {
    const rpc = vi.fn(async () => ({ data: dashboard, error: null }));
    const res = await setup(rpc)(post("referrals.dashboard", {}, owner));
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("jwt", "referral_dashboard", { p_tenant_id: FX.tenants.A });
    const noTenant = await setup(rpc)(post("referrals.dashboard", {}, { Authorization: "Bearer jwt" }));
    expect(ErrorEnvelope.parse(await noTenant.json()).error.field).toBe("tenant_id");
  });

  it("resposta fora do contrato (benefício de outro tipo) vira 500; erro do banco mapeado", async () => {
    const bad = vi.fn(async () => ({ data: { rewards: [{ id: FX.tenants.A, referral_id: FX.tenants.B, kind: "cash", amount: 1, period_start: "2026-10-01", created_at: "2026-10-22T12:00:00Z", invitee_name: null }] }, error: null }));
    expect((await setup(bad)(post("referrals.rewards", {}, owner))).status).toBe(500);
    const denied = vi.fn(async () => ({ data: null, error: { code: "PT403", message: "FORBIDDEN", hint: null } }));
    const res = await setup(denied)(post("referrals.rewards", {}, owner));
    expect(res.status).toBe(403);
    expect(ErrorEnvelope.parse(await res.json()).error.code).toBe("FORBIDDEN");
  });
});
