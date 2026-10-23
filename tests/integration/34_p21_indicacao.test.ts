// P21 pelos handlers com o banco real: dono A gera o convite de colega (P09) → dono B aceita → o worker registra a
// adesão em avaliação (nada concedido) → B tem uso real (clientes e atendimentos concluídos, medidos) → o worker
// concede UM benefício a A (crédito de franquia do mês) e rodar de novo não repete → painel do dono. SEC: outro dono.
import { afterAll, describe, expect, it } from "vitest";
import { ReferralClaimOutput, ReferralDashboardOutput, ReferralLink, ReferralRewardsListOutput } from "@contracts";
import { fails, FX, ok, pool, runJobs, sql, T, U } from "./harness.ts";

const ownerA = { as: U.ownerA, tenant: T.A };
const ownerB = { as: U.ownerB, tenant: T.B };
type Jobs = { referrals?: { registered: number; rewarded: number; blocked: number } };
afterAll(() => pool.end());
const dash = () => ok(ReferralDashboardOutput, "referrals", "referrals.dashboard", { ...ownerA, body: {} });

describe("P21 · indicação de colegas pelos handlers", () => {
  let referralId = "";

  it("1 · convite gerado por A e aceito por B; o worker registra a adesão em avaliação sem conceder nada", async () => {
    await runJobs();
    const link = await ok(ReferralLink, "network", "referral.create", { ...ownerA, key: true, body: { kind: "professional_invites_peer", invitee_name: "Colega B", origin: "web" } });
    const token = /#t=([A-Za-z0-9_-]{43})$/.exec(link.share_url)![1]!;
    referralId = link.referral_id;
    const claim = await ok(ReferralClaimOutput, "network", "referral.claim", { ...ownerB, key: true, body: { token } });
    expect(claim.state).toBe("claimed");
    expect(((await runJobs()) as Jobs).referrals?.registered).toBe(1);
    const d = await dash();
    expect(d.rules).toMatchObject({ min_customers: 3, min_completed_bookings: 2, reward_questions: 50 });
    const inv = d.invites.find((i) => i.referral_id === referralId)!;
    expect(inv).toMatchObject({ state: "claimed", activation: { status: "awaiting_activity", block_reason: null }, reward: null });
    expect(d.summary.rewarded).toBe(0);
  });

  it("2 · uso real medido em B: o worker concede um benefício a A; rodar de novo não repete; o bônus entra na franquia", async () => {
    await sql("insert into public.customers (tenant_id, name) select $1, 'Cliente ref ' || g from generate_series(1, 3) g", [T.B]);
    await sql(`insert into public.bookings (tenant_id, resource_id, customer_id, service_id, starts_at, ends_at, occupied_range, blocks_capacity, status, agreed_price_cents, source)
      select $1, '20000000-0000-4000-8000-00000000000b', (select id from public.customers where tenant_id = $1 order by created_at desc limit 1), '40000000-0000-4000-8000-0000000000b1',
        s, s + interval '30 minutes', tstzrange(s, s + interval '30 minutes', '[)'), true, 'completed', 5000, 'owner'
      from (select clock_timestamp() - (g * 7 || ' days')::interval - interval '400 days' as s from generate_series(1, 2) g) x`, [T.B]);
    const first = (await runJobs()) as Jobs;
    expect(first.referrals?.rewarded).toBe(1);
    expect(((await runJobs()) as Jobs).referrals?.rewarded).toBe(0);
    const d = await dash();
    const inv = d.invites.find((i) => i.referral_id === referralId)!;
    expect(inv.activation?.status).toBe("rewarded");
    expect(Number(inv.activation?.checks.customers)).toBeGreaterThanOrEqual(3);
    expect(inv.reward).toMatchObject({ kind: "agent_questions", amount: 50 });
    expect(d.summary).toMatchObject({ rewarded: 1, bonus_this_month: 50 });
    const rewards = await ok(ReferralRewardsListOutput, "referrals", "referrals.rewards", { ...ownerA, body: {} });
    expect(rewards.rewards.filter((r) => r.referral_id === referralId)).toHaveLength(1);
    const q = await sql<{ bonus: number; month: boolean }>("select bonus, bonus_period_start = date_trunc('month', now() at time zone 'UTC')::date as month from public.agent_quotas where tenant_id = $1", [T.A]);
    expect(q[0]).toEqual({ bonus: 50, month: true });
    const ev = await sql<{ n: number }>("select count(*)::int as n from public.outbox_events where event_type = 'referral.rewarded.v1' and aggregate_id = $1", [referralId]);
    expect(ev[0]!.n).toBe(1);
    expect(JSON.stringify(d)).not.toContain("Cliente ref");
  });

  it("SEC · B não vê o painel de A; sem vínculo é 403", async () => {
    await fails("referrals", "referrals.dashboard", { as: U.ownerB, tenant: T.A, body: {} }, "FORBIDDEN");
    await fails("referrals", "referrals.rewards", { as: U.outsider, tenant: T.A, body: {} }, "FORBIDDEN");
    expect(FX.tenants.A).toBe(T.A);
  });
});
