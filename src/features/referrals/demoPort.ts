// EMULAÇÃO de Indicações para a demonstração sem servidor. Mesmas regras do banco que a tela explica: o aceite do
// convite só registra a adesão; o benefício (crédito de franquia do assistente no mês) vem depois de uso real medido
// (3 clientes e 2 atendimentos concluídos em 60 dias); um benefício por negócio indicado; autoindicação e duplicidade
// bloqueadas; teto de 10 por mês; nunca avaliação, nota ou posição.
import type { ReferralDashboard, ReferralInvite } from "@contracts";
import { FIXED_NOW } from "@contracts/fixtures.ts";
import type { ReferralReward, ReferralsPort } from "./port.ts";

const RULES = { min_customers: 3, min_completed_bookings: 2, window_days: 60, reward_questions: 50, monthly_cap: 10 };
const DAY = 86_400_000;
const at = (days: number) => new Date(Date.parse(FIXED_NOW) + days * DAY).toISOString();
const month = FIXED_NOW.slice(0, 7) + "-01";
const clone = <T>(v: T): T => structuredClone(v);

interface State { invites: ReferralInvite[]; seq: number }
let shared: State | null = null;
function state(): State {
  if (shared) return shared;
  shared = { seq: 0, invites: [
      { referral_id: "e1000000-0000-4000-8000-000000000001", invitee_name: "Marina (exemplo)", invitee_category: "hairdresser", created_at: at(-40), expires_at: at(-10), state: "claimed", claimed_at: at(-38),
        activation: { status: "rewarded", block_reason: null, checks: { customers: 5, completed_bookings: 4 }, eligible_at: at(-20), rewarded_at: at(-20) },
        reward: { id: "e2000000-0000-4000-8000-000000000001", kind: "agent_questions", amount: 50, period_start: month, created_at: at(-20) } },
      { referral_id: "e1000000-0000-4000-8000-000000000002", invitee_name: "Rafael (exemplo)", invitee_category: "barber", created_at: at(-7), expires_at: at(23), state: "claimed", claimed_at: at(-6),
        activation: { status: "awaiting_activity", block_reason: null, checks: { customers: 1, completed_bookings: 0 }, eligible_at: null, rewarded_at: null }, reward: null },
      { referral_id: "e1000000-0000-4000-8000-000000000003", invitee_name: "Marina de novo (exemplo)", invitee_category: null, created_at: at(-5), expires_at: at(25), state: "claimed", claimed_at: at(-4),
        activation: { status: "blocked", block_reason: "duplicate", checks: {}, eligible_at: null, rewarded_at: null }, reward: null },
      { referral_id: "e1000000-0000-4000-8000-000000000004", invitee_name: "Colega sem aceite (exemplo)", invitee_category: null, created_at: at(-1), expires_at: at(29), state: "pending", claimed_at: null, activation: null, reward: null },
  ] };
  return shared;
}
/** Só para testes. */
export function resetDemoState() {
  shared = null;
}

export function createDemoPort(): ReferralsPort {
  const build = (): ReferralDashboard => {
    const inv = state().invites;
    const rewarded = inv.filter((i) => i.reward).length;
    return clone({ rules: RULES, invites: inv, summary: {
      invites: inv.length, claimed: inv.filter((i) => i.state === "claimed").length, rewarded, rewarded_this_month: rewarded,
      bonus_this_month: rewarded * RULES.reward_questions, agent_limit: 200, agent_used: 12 } });
  };
  return {
    kind: "demo",
    async dashboard() {
      return build();
    },
    async rewards() {
      return clone(state().invites.filter((i) => i.reward).map((i) => ({ ...i.reward!, referral_id: i.referral_id, invitee_name: i.invitee_name })) as ReferralReward[]);
    },
    async simulateActivity() {
      let rewarded = 0;
      for (const i of state().invites) {
        const a = i.activation;
        if (!a || a.status !== "awaiting_activity") continue;
        a.checks = { customers: RULES.min_customers, completed_bookings: RULES.min_completed_bookings };
        if (state().invites.filter((x) => x.reward).length >= RULES.monthly_cap) { a.status = "eligible"; a.eligible_at = at(0); continue; }
        a.status = "rewarded"; a.eligible_at = at(0); a.rewarded_at = at(0);
        i.reward = { id: `e2000000-0000-4000-8000-${String(++state().seq + 10).padStart(12, "0")}`, kind: "agent_questions", amount: RULES.reward_questions, period_start: month, created_at: at(0) };
        rewarded++;
      }
      return { rewarded };
    },
  };
}
