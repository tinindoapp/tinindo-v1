// EMULAÇÃO do Assistente para a demonstração sem servidor: o MESMO motor do servidor
// (supabase/functions/_shared/domain/agent) lendo dados de exemplo da Barbearia Exemplo A no relógio fixo.
// Proposta, aprovação (hash + versão, 15 min, uma vez) e execução idempotente seguem as regras do banco.
// Nada sai do navegador.
import { DEFAULT_MESSAGES, ERROR_STATUS, type ErrorCode, RETRYABLE } from "@contracts";
import { FIXED_NOW, FX } from "@contracts/fixtures.ts";
import { runAgent } from "../../../supabase/functions/_shared/domain/agent/engine.ts";
import { addDays, localParts, weekdayOf, type Window, zoned } from "../../../supabase/functions/_shared/domain/agent/time.ts";
import type { AgendaBooking, AgentData, Customer, Finance, Service } from "../../../supabase/functions/_shared/domain/agent/types.ts";
import { canonicalJson, sha256Hex } from "../../../supabase/functions/_shared/http/command.ts";
import { ApiError } from "../../lib/api/client.ts";
import { DEMO_EXPENSES, DEMO_OPEN_RECEIVABLES, demoPayments, demoVisits } from "../../lib/demo/dataset.ts";
import type { AgentPort, Approval, Proposal, Receipt } from "./port.ts";

const TZ = "America/Sao_Paulo";
const TENANT = { id: FX.tenants.A, name: "Barbearia Exemplo A", timezone: TZ };
const at = (date: string, time: string) => zoned(date, time, TZ).toISOString();
const PROPOSAL_MIN = 30;
const APPROVAL_MIN = 15;

function fail(code: ErrorCode, field?: string): never {
  throw new ApiError(code, DEFAULT_MESSAGES[code], ERROR_STATUS[code], crypto.randomUUID(), RETRYABLE.has(code), field);
}

const SERVICES: Service[] = [
  { id: FX.services.corteA, name: "Corte", duration_min: 30, buffer_before_min: 0, buffer_after_min: 10, base_price_cents: 6000,
    min_price_cents: 4500, estimated_cost_cents: 1500, fee_bps: 500 },
  { id: FX.services.barbaA, name: "Barba", duration_min: 20, buffer_before_min: 0, buffer_after_min: 5, base_price_cents: 4000,
    min_price_cents: 3000, estimated_cost_cents: null, fee_bps: null },
];
const CUSTOMERS: Customer[] = [
  { id: FX.customers.abInA, name: "Cliente Exemplo Ana", declared_source: "referral" },
  { id: FX.customers.guestInA, name: "Cliente Exemplo Bruno", declared_source: "walk_in" },
  { id: "30000000-0000-4000-8000-0000000000a3", name: "Maria Exemplo Silva", declared_source: "referral" },
  { id: "30000000-0000-4000-8000-0000000000a4", name: "Maria Exemplo Souza", declared_source: "instagram" },
];
const HOURS: Record<number, [string, string][]> = {
  1: [["09:00", "12:00"], ["13:00", "19:00"]], 2: [["09:00", "12:00"], ["13:00", "19:00"]], 3: [["09:00", "12:00"], ["13:00", "19:00"]],
  4: [["09:00", "12:00"], ["13:00", "19:00"]], 5: [["09:00", "12:00"], ["13:00", "19:00"]], 6: [["09:00", "14:00"]],
};

interface DemoProposal extends Proposal { createdAt: number }
interface State {
  bookings: AgendaBooking[];
  proposals: Map<string, DemoProposal>;
  approvals: Map<string, Approval & { payload_hash: string }>;
  receipts: Map<string, Receipt>;
  idem: Map<string, unknown>;
}

let shared: State | null = null;
function state(): State {
  if (shared) return shared;
  // Agenda da base de exemplo única (dataset.ts): os mesmos atendimentos da Agenda, do Caixa e do Resultado.
  const buffer = (svc: string) => SERVICES.find((x) => x.id === svc)?.buffer_after_min ?? 0;
  shared = {
    bookings: demoVisits().filter((v) => v.status !== "expired").map((v): AgendaBooking => ({
      id: v.id, service_id: v.service_id, customer_id: v.customer_id, starts_at: v.starts_at, ends_at: v.ends_at, status: v.status as AgendaBooking["status"],
      agreed_price_cents: v.status === "held" ? null : v.agreed_price_cents, version: 1,
      occupied: { starts_at: v.starts_at, ends_at: new Date(Date.parse(v.ends_at) + buffer(v.service_id) * 60_000).toISOString() },
    })),
    proposals: new Map(),
    approvals: new Map(),
    receipts: new Map(),
    idem: new Map(),
  };
  return shared;
}

/** Só para testes. */
export function resetDemoState() {
  shared = null;
}

const now = () => new Date(FIXED_NOW);
const once = async <T>(key: string, run: () => Promise<T> | T): Promise<T> => {
  const s = state();
  if (s.idem.has(key)) return structuredClone(s.idem.get(key)) as T;
  const v = await run();
  s.idem.set(key, structuredClone(v));
  return v;
};

function data(): AgentData {
  const asOf = FIXED_NOW;
  return {
    directory: async () => ({
      services: SERVICES, customers: CUSTOMERS, customers_total: CUSTOMERS.length,
      pricing_rules: [{ service_id: FX.services.corteA, rule_version: 3, windows: [{ weekday: 2, local_start: "13:00", local_end: "17:00" }],
        discount_bps: 1500, max_discount_bps: 1500, target_margin_bps: 0, valid: { starts_at: "2026-01-01T03:00:00Z", ends_at: "2027-01-01T03:00:00Z" } }],
      cancellation: { notice_hours: 2, late_fee_bps: null }, waitlist: { active: 1, offered: 0 }, as_of: asOf,
    }),
    agenda: async (w: Window) => {
      const days = [];
      for (let d = localParts(w.starts_at, TZ).date; zoned(d, "00:00", TZ).getTime() < Date.parse(w.ends_at); d = addDays(d, 1)) {
        days.push({ date: d, open: (HOURS[weekdayOf(d)] ?? []).map(([s, e]) => ({ starts_at: at(d, s), ends_at: at(d, e) })), blocks: [] });
      }
      const s = Date.parse(w.starts_at);
      const e = Date.parse(w.ends_at);
      return {
        resource_id: FX.resources.A, timezone: TZ, days, as_of: asOf,
        bookings: structuredClone(state().bookings.filter((b) => Date.parse(b.starts_at) >= s && Date.parse(b.starts_at) < e))
          .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at)),
      };
    },
    // Recebido, gasto e a receber da base de exemplo única: o mesmo que o Caixa e o Resultado mostram no período.
    finance: async (w: Window): Promise<Finance> => {
      const inW = (x: string) => Date.parse(x) >= Date.parse(w.starts_at) && Date.parse(x) < Date.parse(w.ends_at) && Date.parse(x) <= now().getTime();
      const pays = demoPayments().filter((x) => inW(x.received_at));
      const exps = DEMO_EXPENSES.filter((x) => inW(x.paid_at));
      const supplies = exps.filter((x) => x.category === "supplies");
      const open = DEMO_OPEN_RECEIVABLES;
      const sum = (xs: readonly { amount_cents: number }[]) => xs.reduce((a, x) => a + x.amount_cents, 0);
      const dates = [...pays.map((x) => x.received_at), ...exps.map((x) => x.paid_at)].sort();
      const due = open.map((o) => o.due_at).filter((d): d is string => !!d && Date.parse(d) >= now().getTime()).sort();
      return {
        period: w, received_cents: sum(pays), payments_count: pays.length, spent_cents: sum(exps), expenses_count: exps.length,
        supplies_cents: sum(supplies), supplies_count: supplies.length, receivable_open_cents: sum(open), receivable_open_count: open.length,
        receivable_next_due_at: due[0] ?? null, records_count: pays.length + exps.length,
        first_record_at: dates[0] ?? null, packages: [], as_of: asOf,
      };
    },
  };
}

const hashOf = (payload: unknown) => sha256Hex(`${canonicalJson(payload)}|policy:1`);
const overlaps = (a: Window, b: Window) => Date.parse(a.starts_at) < Date.parse(b.ends_at) && Date.parse(b.starts_at) < Date.parse(a.ends_at);

/** Execução emulada: revalida o horário/versão como o banco e devolve {kind, id} ou o motivo da recusa. */
function run(p: DemoProposal): { ref: Receipt["result_ref"] } | { reason: string } {
  const s = state();
  const pl = p.payload as Record<string, string | number>;
  const active = s.bookings.filter((b) => b.status === "held" || b.status === "confirmed");
  if (p.tool === "booking.create") {
    const svc = SERVICES.find((x) => x.id === pl.service_id)!;
    const occ = { starts_at: String(pl.starts_at), ends_at: new Date(Date.parse(String(pl.ends_at)) + svc.buffer_after_min * 60_000).toISOString() };
    if (active.some((b) => overlaps(b.occupied, occ))) return { reason: "SLOT_CONFLICT" };
    const id = crypto.randomUUID();
    s.bookings.push({ id, service_id: svc.id, customer_id: String(pl.customer_id), starts_at: String(pl.starts_at), ends_at: String(pl.ends_at),
      occupied: occ, status: "confirmed", agreed_price_cents: Number(pl.expected_price_cents), version: 1 });
    return { ref: { kind: "booking", id } };
  }
  if (p.tool === "booking.reschedule" || p.tool === "booking.cancel") {
    const b = s.bookings.find((x) => x.id === pl.booking_id);
    if (!b || !["held", "confirmed"].includes(b.status)) return { reason: "POLICY_REJECTED" };
    if (b.version !== Number(pl.expected_version)) return { reason: "STALE_VERSION" };
    if (p.tool === "booking.cancel") {
      b.status = "cancelled" as AgendaBooking["status"];
    } else {
      const svc = SERVICES.find((x) => x.id === b.service_id)!;
      const occ = { starts_at: String(pl.starts_at), ends_at: new Date(Date.parse(String(pl.ends_at)) + svc.buffer_after_min * 60_000).toISOString() };
      if (active.some((x) => x.id !== b.id && overlaps(x.occupied, occ))) return { reason: "SLOT_CONFLICT" };
      Object.assign(b, { starts_at: pl.starts_at, ends_at: pl.ends_at, occupied: occ });
    }
    b.version += 1;
    return { ref: { kind: "booking", id: b.id } };
  }
  return { ref: { kind: "pricing_proposal", id: crypto.randomUUID() } };
}

export function createDemoPort(): AgentPort {
  return {
    kind: "demo",
    ask: (text, key) => once(`ask:${key}`, async () => {
      const r = await runAgent(text, { tenant: TENANT, role: "owner", now: now() }, data());
      let proposal: Proposal | null = null;
      if (r.draft) {
        const expires = new Date(now().getTime() + PROPOSAL_MIN * 60_000).toISOString();
        const p: DemoProposal = {
          proposal_id: crypto.randomUUID(), tenant_id: TENANT.id, tool: r.draft.tool, payload: r.draft.payload,
          payload_hash: await hashOf(r.draft.payload), policy_version: 1, version: 1, expires_at: expires,
          approval_state: "pending", summary: r.draft.summary, createdAt: now().getTime(),
        };
        state().proposals.set(p.proposal_id, p);
        const { createdAt: _c, ...pub } = p;
        void _c;
        proposal = pub;
      }
      return { state: r.state, text: r.text, sources: r.sources, proposal };
    }),
    approve: (input, key) => once(`approve:${key}`, () => {
      const p = state().proposals.get(input.proposal_id);
      if (!p) fail("NOT_FOUND");
      if (p.version !== input.version || p.approval_state !== "pending") fail("STALE_VERSION");
      if (p.payload_hash !== input.payload_hash) fail("POLICY_REJECTED", "payload_hash");
      if (Date.parse(p.expires_at) <= now().getTime()) fail("POLICY_REJECTED", "expires_at");
      const a = {
        approval_id: crypto.randomUUID(), proposal_id: p.proposal_id, approver_user_id: FX.users.ownerA,
        approved_at: now().toISOString(), expires_at: new Date(now().getTime() + APPROVAL_MIN * 60_000).toISOString(), payload_hash: p.payload_hash,
      };
      state().approvals.set(a.approval_id, a);
      p.approval_state = "approved";
      p.version += 1;
      const { payload_hash: _h, ...pub } = a;
      void _h;
      return pub;
    }),
    execute: (approvalId, key) => once(`execute:${key}`, () => {
      const s = state();
      const a = s.approvals.get(approvalId);
      if (!a) fail("NOT_FOUND");
      const prior = s.receipts.get(approvalId);
      if (prior) return prior;
      const p = s.proposals.get(a.proposal_id)!;
      let receipt: Receipt;
      if (Date.parse(a.expires_at) <= now().getTime() || p.approval_state !== "approved" || p.payload_hash !== a.payload_hash) {
        receipt = { approval_id: approvalId, status: "rejected_by_policy", result_ref: null, executed_at: now().toISOString() };
        p.approval_state = "invalidated";
      } else {
        const r = run(p);
        receipt = "ref" in r
          ? { approval_id: approvalId, status: "executed", result_ref: r.ref, executed_at: now().toISOString() }
          : { approval_id: approvalId, status: "rejected_by_policy", result_ref: null, executed_at: now().toISOString() };
        p.approval_state = "ref" in r ? "executed" : "invalidated";
      }
      p.version += 1;
      s.receipts.set(approvalId, receipt);
      return receipt;
    }),
  };
}
