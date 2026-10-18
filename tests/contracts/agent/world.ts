// Mundo em memória para o harness de avaliação do assistente (tests/agent-evals/fixtures.json + overlay).
// Emula SÓ as leituras das ferramentas e o portão (vínculo + franquia) do servidor. Aprovar/executar não é
// emulado aqui: AE-37…40 rodam no banco real (supabase/tests/database/08_agent.test.sql e
// tests/db-concurrency/08_agent.sh).
import { readFileSync } from "node:fs";
import type {
  Agenda,
  AgendaBooking,
  AgentData,
  Customer,
  Directory,
  Finance,
  PriceRule,
  Service,
} from "../../../supabase/functions/_shared/domain/agent/types.ts";
import { ToolError } from "../../../supabase/functions/_shared/domain/agent/types.ts";
import { addDays, localParts, weekdayOf, type Window, zoned } from "../../../supabase/functions/_shared/domain/agent/time.ts";

const here = new URL("../../agent-evals/", import.meta.url);
/* eslint-disable @typescript-eslint/no-explicit-any -- JSON livre das fixtures */
export const FIXTURES: any = JSON.parse(readFileSync(new URL("fixtures.json", here), "utf8"));
export const CASES: any[] = JSON.parse(readFileSync(new URL("cases.json", here), "utf8")).cases;

const TZ = "America/Sao_Paulo";
const RESOURCE = { A: "20000000-0000-4000-8000-00000000000a", B: "20000000-0000-4000-8000-00000000000b" } as const;
type TenantKey = "A" | "B";

interface Tenant {
  key: TenantKey;
  id: string;
  name: string;
  hours: Record<number, [string, string][]>;
  services: Service[];
  customers: Customer[];
  bookings: AgendaBooking[];
  rules: PriceRule[];
  cancellation: Directory["cancellation"];
  waitlistActive: number;
  payments: { id: string; at: string; cents: number }[];
  expenses: { id: string; at: string; cents: number; supplies: boolean }[];
  receivables: { id: string; created: string; due: string; cents: number }[];
  packages: Finance["packages"];
}

const at = (date: string, time: string) => zoned(date, time, TZ).toISOString();

function hoursOf(raw: any): Record<number, [string, string][]> {
  const out: Record<number, [string, string][]> = {};
  if (!raw) return out;
  for (const d of [1, 2, 3, 4, 5]) out[d] = raw["mon-fri"] ?? [];
  out[6] = raw.sat ?? [];
  out[0] = raw.sun ?? [];
  return out;
}

function services(raw: any): Service[] {
  return Object.values(raw ?? {}).map((s: any) => ({
    id: s.id, name: s.name, duration_min: s.duration_min, buffer_before_min: 0, buffer_after_min: s.buffer_after_min ?? 0,
    base_price_cents: s.base_price_cents, min_price_cents: s.min_price_cents,
    estimated_cost_cents: s.estimated_cost_cents ?? null, fee_bps: s.fee_bps ?? null,
  }));
}

export class World {
  tenants: Record<TenantKey, Tenant>;
  memberships: { user: string; tenant: TenantKey; role: "owner" | "staff" }[] = [];
  quota: Record<TenantKey, number> = { A: 200, B: 200 };
  proposals: { proposal_id: string; state: string }[] = [];
  drafts = 0;
  now: Date;

  constructor(setup: any) {
    const f = FIXTURES;
    this.now = new Date(setup.now ?? f.clock.now);
    const A = f.tenants.A;
    const B = f.tenants.B;
    const svcA = services(A.services);
    const byKeyA = (k: string) => A.customers[k]?.id ?? k;
    const svcId = (k: string) => A.services[k]?.id ?? k;
    const bookingA = (b: any, date: string): AgendaBooking => {
      const [s, e] = b.time.split("-");
      const svc = svcA.find((x) => x.id === svcId(b.service))!;
      return {
        id: b.id, service_id: svc.id, customer_id: b.customer ? byKeyA(b.customer) : null, starts_at: at(date, s), ends_at: at(date, e),
        occupied: { starts_at: at(date, s), ends_at: new Date(Date.parse(at(date, e)) + svc.buffer_after_min * 60_000).toISOString() },
        status: b.status, agreed_price_cents: b.agreed_price_cents ?? null, version: 1,
      };
    };
    const fin = A.finance_records_2026_10_12_to_18;
    this.tenants = {
      A: {
        key: "A", id: A.id, name: A.name, hours: hoursOf(A.business_hours), services: svcA,
        customers: Object.values(A.customers).map((c: any) => ({ id: c.id, name: c.name, declared_source: c.declared_source ?? null })),
        bookings: A.bookings_tuesday_2026_10_20.map((b: any) => bookingA(b, "2026-10-20")),
        rules: A.pricing_rules.map((r: any) => ({
          service_id: A.services.corteA.id, rule_version: r.version,
          windows: [{ weekday: 2, local_start: r.from, local_end: r.to }], discount_bps: r.discount_bps, max_discount_bps: r.discount_bps,
          target_margin_bps: 0, valid: { starts_at: "2026-01-01T03:00:00Z", ends_at: "2027-01-01T03:00:00Z" },
        })),
        cancellation: { notice_hours: 2, late_fee_bps: null },
        waitlistActive: 0,
        payments: fin.payments.map((p: any) => ({ id: p.id, at: at(p.date, "12:00"), cents: p.amount_cents })),
        expenses: fin.expenses.map((e: any) => ({ id: e.id, at: at(e.date, "12:00"), cents: e.amount_cents, supplies: true })),
        receivables: fin.open_receivables.map((r: any) => ({ id: r.id, created: at("2026-10-14", "12:00"), due: at(r.due, "12:00"), cents: r.amount_cents })),
        packages: [],
      },
      B: {
        key: "B", id: B.id, name: B.name, hours: {}, services: services(B.services),
        customers: Object.values(B.customers).map((c: any) => ({ id: c.id, name: c.name, declared_source: null })),
        bookings: [], rules: [], cancellation: null, waitlistActive: 0, payments: [], expenses: [], receivables: [],
        packages: Object.values(B.packages).map((p: any) => ({
          id: p.id, customer_id: B.customers[p.customer].id, service_id: B.services.sessaoB.id,
          purchased_credits: p.purchased_credits, remaining_credits: p.remaining_credits,
        })),
      },
    };
    for (const [key, actor] of Object.entries<any>(f.actors)) {
      for (const m of actor.memberships) this.memberships.push({ user: actor.user_id, tenant: m.tenant, role: m.role });
      void key;
    }
    const o = setup.overlay ?? {};
    for (const c of o.customers ?? []) this.tenants.A.customers.push({ id: c.id, name: c.name, declared_source: null });
    for (const b of o.bookings ?? []) this.tenants.A.bookings.push(bookingA(b, b.date));
    for (const m of o.memberships ?? []) this.memberships.push({ user: f.actors[m.user].user_id, tenant: m.tenant, role: m.role });
    for (const p of o.proposals ?? []) this.proposals.push({ proposal_id: p.proposal_id, state: p.approval_state });
    this.tenants.A.waitlistActive = (o.waitlist_notes ?? []).length;
    if (setup.quota) this.quota[setup.tenant as TenantKey] = setup.quota.per_tenant_month_remaining;
    for (const [k, v] of Object.entries<number>(setup.quota_by_tenant ?? {})) this.quota[k as TenantKey] = v;
  }

  /** Portão do servidor (agent_run_start): vínculo antes de tudo, depois franquia. */
  gate(actorKey: string, tenantKey: TenantKey): { ok: true; role: "owner" | "staff" } | { ok: false; status: number; code: string } {
    const user = FIXTURES.actors[actorKey].user_id;
    const m = this.memberships.find((x) => x.user === user && x.tenant === tenantKey);
    if (!m) return { ok: false, status: 403, code: "FORBIDDEN" };
    if (this.quota[tenantKey] <= 0) return { ok: false, status: 429, code: "QUOTA_EXCEEDED" };
    this.quota[tenantKey] -= 1;
    return { ok: true, role: m.role };
  }

  data(tenantKey: TenantKey, role: "owner" | "staff"): AgentData {
    const t = this.tenants[tenantKey];
    const asOf = this.now.toISOString();
    return {
      directory: async () => ({
        services: t.services, customers: t.customers, customers_total: t.customers.length, pricing_rules: t.rules,
        cancellation: t.cancellation, waitlist: role === "owner" ? { active: t.waitlistActive, offered: 0 } : null, as_of: asOf,
      }),
      agenda: async (w: Window): Promise<Agenda> => {
        const days = [];
        for (let d = localParts(w.starts_at, TZ).date; zoned(d, "00:00", TZ).getTime() < Date.parse(w.ends_at); d = addDays(d, 1)) {
          days.push({ date: d, open: (t.hours[weekdayOf(d)] ?? []).map(([s, e]) => ({ starts_at: at(d, s), ends_at: at(d, e) })), blocks: [] });
        }
        const s = Date.parse(w.starts_at);
        const e = Date.parse(w.ends_at);
        return {
          resource_id: RESOURCE[tenantKey], timezone: TZ, days, as_of: asOf,
          bookings: t.bookings.filter((b) => Date.parse(b.starts_at) >= s && Date.parse(b.starts_at) < e)
            .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at)),
        };
      },
      finance: async (w: Window): Promise<Finance> => {
        if (role !== "owner") throw new ToolError("FORBIDDEN");
        const s = Date.parse(w.starts_at);
        const e = Date.parse(w.ends_at);
        const inW = (x: string) => Date.parse(x) >= s && Date.parse(x) < e;
        const pays = t.payments.filter((p) => inW(p.at));
        const exps = t.expenses.filter((x) => inW(x.at));
        const recs = t.receivables.filter((r) => inW(r.created));
        const all = [...t.payments.map((p) => p.at), ...t.expenses.map((x) => x.at), ...t.receivables.map((r) => r.created)].sort();
        return {
          period: w, received_cents: pays.reduce((a, p) => a + p.cents, 0), payments_count: pays.length,
          spent_cents: exps.reduce((a, x) => a + x.cents, 0), expenses_count: exps.length,
          supplies_cents: exps.filter((x) => x.supplies).reduce((a, x) => a + x.cents, 0), supplies_count: exps.filter((x) => x.supplies).length,
          receivable_open_cents: t.receivables.reduce((a, r) => a + r.cents, 0), receivable_open_count: t.receivables.length,
          receivable_next_due_at: t.receivables.map((r) => r.due).sort()[0] ?? null,
          records_count: pays.length + exps.length + recs.length, first_record_at: all[0] ?? null, packages: t.packages, as_of: asOf,
        };
      },
    };
  }

  context(tenantKey: TenantKey, role: "owner" | "staff") {
    const t = this.tenants[tenantKey];
    return { tenant: { id: t.id, name: t.name, timezone: TZ }, role, now: this.now };
  }
}
