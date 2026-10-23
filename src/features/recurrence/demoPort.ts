// EMULAÇÃO de Assinaturas para a demonstração sem servidor. Mesmas regras do banco que a tela explica: adesão congela
// os termos; um ciclo = pacote de sessões + recebível pelo preço aceito; mudar o plano não altera assinaturas;
// renovação ao vencer (um ciclo por número); cancelar ao fim do ciclo não renova; cancelar agora preserva o saldo.
import { DEFAULT_MESSAGES, ERROR_STATUS, type ErrorCode, type RecurrenceCycle, type RecurrencePlan, type RecurrenceSubscription, RETRYABLE } from "@contracts";
import { FIXED_NOW, FX, services as fixtureServices, tenantA } from "@contracts/fixtures.ts";
import { ApiError } from "../../lib/api/client.ts";
import type { RecurrenceBase, RecurrencePort } from "./port.ts";

function fail(code: ErrorCode, field?: string): never {
  throw new ApiError(code, DEFAULT_MESSAGES[code], ERROR_STATUS[code], crypto.randomUUID(), RETRYABLE.has(code), field);
}
const clone = <T>(v: T): T => structuredClone(v);
export const DEMO_CUSTOMERS = [
  { id: FX.customers.abInA, name: "Ana Beatriz (exemplo)" },
  { id: FX.customers.guestInA, name: "Carlos (exemplo)" },
];

interface State { plans: RecurrencePlan[]; subs: RecurrenceSubscription[]; cycles: Map<string, RecurrenceCycle[]>; idem: Map<string, unknown>; seq: number; clock: number }
let shared: State | null = null;
const ts = () => { const s = shared!; s.clock += 1000; return new Date(s.clock).toISOString(); };
const id = (p: string) => `${p}-0000-4000-8000-${String(++shared!.seq).padStart(12, "0")}`;
function state(): State {
  if (!shared) {
    shared = { plans: [], subs: [], cycles: new Map(), idem: new Map(), seq: 0, clock: Date.parse(FIXED_NOW) };
    const corte = fixtureServices.find((s) => s.id === FX.services.corteA)!;
    shared.plans.push({ id: id("a1000000"), service_id: corte.id, service_name: corte.name, name: "Corte mensal", sessions_per_cycle: 4, cycle_days: 30, price_cents: 20000, active: true, subscribers: 0, created_at: ts(), version: 1 });
  }
  return shared;
}
/** Só para testes. */
export function resetDemoState() {
  shared = null;
}
/** Só para testes e para a demonstração: avança o relógio (vence ciclos). */
export function advanceDemoClock(ms: number) {
  state().clock += ms;
}
const once = async <T>(key: string, run: () => T): Promise<T> => {
  const s = state();
  if (s.idem.has(key)) return clone(s.idem.get(key)) as T;
  const v = run();
  s.idem.set(key, clone(v));
  return clone(v);
};
const hash = (terms: unknown) => {
  let h = 7;
  for (const ch of JSON.stringify(terms)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h.toString(16).padStart(8, "0").repeat(8);
};
function openCycle(sub: RecurrenceSubscription, cycleNo: number, startsAt: string): RecurrenceCycle {
  const s = state();
  const list = s.cycles.get(sub.id) ?? [];
  const existing = list.find((c) => c.cycle_no === cycleNo);
  if (existing) return existing;
  const ends = new Date(Date.parse(startsAt) + sub.terms.cycle_days * 86_400_000).toISOString();
  const pkgId = id("a2000000");
  const c: RecurrenceCycle = { id: id("a3000000"), cycle_no: cycleNo, starts_at: startsAt, ends_at: ends,
    package: { package_id: pkgId, purchased_credits: sub.terms.sessions_per_cycle, remaining_credits: sub.terms.sessions_per_cycle, expires_at: ends },
    receivable: { id: id("a4000000"), customer_id: sub.customer_id, booking_id: null, package_id: pkgId, description: `Assinatura ${sub.terms.plan_name} · ciclo ${cycleNo}`,
      amount_cents: sub.terms.price_cents, paid_cents: 0, open_cents: sub.terms.price_cents, due_at: startsAt, status: "open", version: 1, created_at: ts() } };
  list.push(c);
  s.cycles.set(sub.id, list);
  sub.cycles_count = cycleNo;
  sub.next_renewal_at = ends;
  sub.current_cycle = c;
  return c;
}
const withCurrent = (sub: RecurrenceSubscription): RecurrenceSubscription => {
  const list = state().cycles.get(sub.id) ?? [];
  return clone({ ...sub, current_cycle: list[list.length - 1] ?? null });
};
const findSub = (subId: string) => state().subs.find((x) => x.id === subId) ?? fail("NOT_FOUND");
const countSubscribers = () => {
  const s = state();
  for (const p of s.plans) p.subscribers = s.subs.filter((x) => x.plan_id === p.id && x.status === "active").length;
};

export function createDemoPort(): RecurrencePort {
  return {
    kind: "demo",
    async base(): Promise<RecurrenceBase> {
      return { timezone: tenantA.timezone, customers: clone(DEMO_CUSTOMERS), services: clone(fixtureServices.filter((s) => s.tenant_id === FX.tenants.A)) };
    },
    async plans() {
      countSubscribers();
      return clone(state().plans);
    },
    savePlan(input, key) {
      return once(key, () => {
        const s = state();
        const svc = fixtureServices.find((x) => x.id === input.service_id) ?? fail("NOT_FOUND", "service_id");
        if (!(input.sessions_per_cycle >= 1 && input.sessions_per_cycle <= 31) || input.price_cents < 1 || ![7, 14, 30].includes(input.cycle_days ?? 30)) fail("VALIDATION_ERROR", "plan");
        if (input.plan_id) {
          const p = s.plans.find((x) => x.id === input.plan_id) ?? fail("NOT_FOUND");
          if (p.version !== input.expected_version) fail("STALE_VERSION");
          Object.assign(p, { service_id: svc.id, service_name: svc.name, name: input.name.trim(), sessions_per_cycle: input.sessions_per_cycle, cycle_days: input.cycle_days ?? p.cycle_days, price_cents: input.price_cents, active: input.active ?? p.active, version: p.version + 1 });
          return clone(p);
        }
        const p: RecurrencePlan = { id: id("a1000000"), service_id: svc.id, service_name: svc.name, name: input.name.trim(), sessions_per_cycle: input.sessions_per_cycle, cycle_days: input.cycle_days ?? 30, price_cents: input.price_cents, active: input.active ?? true, subscribers: 0, created_at: ts(), version: 1 };
        s.plans.push(p);
        return clone(p);
      });
    },
    async subscriptions() {
      return state().subs.map(withCurrent);
    },
    subscribe(planId, customerId, key) {
      return once(key, () => {
        const s = state();
        const p = s.plans.find((x) => x.id === planId) ?? fail("NOT_FOUND", "plan_id");
        if (!p.active) fail("POLICY_REJECTED", "plan_id");
        if (!DEMO_CUSTOMERS.some((c) => c.id === customerId)) fail("NOT_FOUND", "customer_id");
        if (s.subs.some((x) => x.plan_id === planId && x.customer_id === customerId && x.status === "active")) fail("POLICY_REJECTED", "subscription");
        const terms = { plan_name: p.name, service_id: p.service_id, service_name: p.service_name, sessions_per_cycle: p.sessions_per_cycle, cycle_days: p.cycle_days, price_cents: p.price_cents };
        const now = ts();
        const sub: RecurrenceSubscription = { id: id("a5000000"), plan_id: p.id, customer_id: customerId, customer_name: DEMO_CUSTOMERS.find((c) => c.id === customerId)!.name, status: "active",
          terms, terms_hash: hash(terms), accepted_at: now, accepted_source: "owner_declared", started_at: now, next_renewal_at: null, cancel_at_period_end: false, cancelled_at: null, cancel_reason: null,
          cycles_count: 0, current_cycle: null, version: 1 };
        s.subs.push(sub);
        openCycle(sub, 1, now);
        countSubscribers();
        return withCurrent(sub);
      });
    },
    cancel(input, atPeriodEnd, reason, key) {
      return once(key, () => {
        const sub = findSub(input.id);
        if (sub.version !== input.version) fail("STALE_VERSION");
        if (sub.status !== "active") fail("POLICY_REJECTED", "status");
        if (atPeriodEnd) Object.assign(sub, { cancel_at_period_end: true, cancel_reason: reason });
        else Object.assign(sub, { status: "cancelled", cancelled_at: ts(), next_renewal_at: null, cancel_reason: reason });
        sub.version += 1;
        countSubscribers();
        return withCurrent(sub);
      });
    },
    resume(input, key) {
      return once(key, () => {
        const sub = findSub(input.id);
        if (sub.version !== input.version) fail("STALE_VERSION");
        if (sub.status !== "active" || !sub.cancel_at_period_end) fail("POLICY_REJECTED", "status");
        Object.assign(sub, { cancel_at_period_end: false, cancel_reason: null });
        sub.version += 1;
        return withCurrent(sub);
      });
    },
    async cycles(subscriptionId) {
      findSub(subscriptionId);
      return clone([...(state().cycles.get(subscriptionId) ?? [])].reverse());
    },
    async tick() {
      const s = state();
      const r = { renewed: 0, closed: 0 };
      for (const sub of s.subs) {
        if (sub.status !== "active" || !sub.next_renewal_at || Date.parse(sub.next_renewal_at) > s.clock) continue;
        if (sub.cancel_at_period_end) { Object.assign(sub, { status: "cancelled", cancelled_at: ts(), next_renewal_at: null }); sub.version += 1; r.closed++; }
        else { openCycle(sub, sub.cycles_count + 1, sub.next_renewal_at); r.renewed++; }
      }
      countSubscribers();
      return r;
    },
  };
}
