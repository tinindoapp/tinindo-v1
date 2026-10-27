// EMULAÇÃO de Pagamentos para a demonstração sem servidor. Mesmas regras do banco que a tela explica: cobrança pelo
// saldo em aberto, uma viva por recebível; pago só quando o "PSP" avisa (webhook) ou é consultado (sync); a mesma
// notificação não dá baixa duas vezes; sem resposta = desconhecido, nunca presumido; estorno total vinculado;
// conciliação lista diferenças. Nenhum dinheiro existe: o PSP fictício é um mapa na aba.
import {
  DEFAULT_MESSAGES,
  ERROR_STATUS,
  type ErrorCode,
  type PaymentCharge,
  type PaymentRefund,
  type Receivable,
  type Reconciliation,
  RETRYABLE,
} from "@contracts";
import { FIXED_NOW, FX } from "@contracts/fixtures.ts";
import { ApiError } from "../../lib/api/client.ts";
import type { ChargeCreated, ChargesList, LinkView, PaymentLinkPort, PaymentsPort, SimPayResult } from "./port.ts";

function fail(code: ErrorCode, field?: string): never {
  throw new ApiError(code, DEFAULT_MESSAGES[code], ERROR_STATUS[code], crypto.randomUUID(), RETRYABLE.has(code), field);
}
const clone = <T>(v: T): T => structuredClone(v);
export const DEMO_BUSINESS = "Barbearia do Léo (exemplo)";
const TZ = "America/Sao_Paulo";

interface Ledger { status: "pending" | "paid" | "expired" | "cancelled" | "refunded"; amount_cents: number; paid_at: string | null }
interface State {
  receivables: Receivable[];
  charges: (PaymentCharge & { token: string })[];
  refunds: PaymentRefund[];
  entries: { id: string; charge_id: string; amount_cents: number; reversal_of: string | null; received_at: string }[];
  psp: Map<string, Ledger>;
  events: Set<string>;
  reconciliations: Reconciliation[];
  idem: Map<string, unknown>;
  seq: number;
  clock: number;
  unknownOnce: Set<number>;
}
let shared: State | null = null;
// A cobrança de exemplo fica guardada na aba (sessionStorage): abrir o link /pagar#t=… recarregando a página continua
// encontrando a cobrança. Some ao fechar a aba; nunca vai a servidor.
const STORE = "tinindo.demo.payments";
type Stored = Omit<State, "psp" | "events" | "idem" | "unknownOnce"> & { psp: [string, Ledger][]; events: string[]; idem: [string, unknown][]; unknownOnce: number[] };
function load(): State | null {
  try {
    const raw = sessionStorage.getItem(STORE);
    if (!raw) return null;
    const v = JSON.parse(raw) as Stored;
    return { ...v, psp: new Map(v.psp), events: new Set(v.events), idem: new Map(v.idem), unknownOnce: new Set(v.unknownOnce) };
  } catch {
    return null;
  }
}
function save() {
  if (!shared) return;
  try {
    const v: Stored = { ...shared, psp: [...shared.psp], events: [...shared.events], idem: [...shared.idem], unknownOnce: [...shared.unknownOnce] };
    sessionStorage.setItem(STORE, JSON.stringify(v));
  } catch {
    /* sem armazenamento: vale enquanto a página estiver aberta */
  }
}
function state(): State {
  if (!shared) shared = load();
  if (!shared) {
    shared = { receivables: [], charges: [], refunds: [], entries: [], psp: new Map(), events: new Set(), reconciliations: [], idem: new Map(), seq: 0, clock: Date.parse(FIXED_NOW), unknownOnce: new Set() };
    const mk = (customer_id: string | null, description: string, amount_cents: number) => shared!.receivables.push({
      id: id("e2000000"), customer_id, booking_id: null, package_id: null, description, amount_cents, paid_cents: 0, open_cents: amount_cents, due_at: null, status: "open", version: 1, created_at: ts() });
    mk(FX.customers.abInA, "Corte · Ana Beatriz (exemplo)", 6000);
    mk(FX.customers.guestInA, "Barba · Carlos (exemplo)", 4000);
    mk(null, "Produto · pomada", 3098);
  }
  return shared;
}
/** Só para testes: esquece a memória da aba como um recarregamento (o que foi guardado na sessão continua). */
export function forgetDemoMemory() {
  shared = null;
}
/** Só para testes. */
export function resetDemoState() {
  shared = null;
  try {
    sessionStorage.removeItem(STORE);
  } catch {
    /* sem armazenamento */
  }
}
const ts = () => {
  const s = shared!;
  s.clock += 1000;
  return new Date(s.clock).toISOString();
};
const id = (p: string) => `${p}-0000-4000-8000-${String(++shared!.seq).padStart(12, "0")}`;
const once = async <T>(key: string, run: () => T): Promise<T> => {
  const s = state();
  if (s.idem.has(key)) return clone(s.idem.get(key)) as T;
  const v = run();
  s.idem.set(key, clone(v));
  save();
  return clone(v);
};
const strip = (c: PaymentCharge & { token: string }): PaymentCharge => {
  const { token: _t, ...rest } = c;
  return clone(rest);
};
const findCharge = (chargeId: string) => state().charges.find((c) => c.id === chargeId) ?? fail("NOT_FOUND");
const receivableOf = (c: PaymentCharge) => state().receivables.find((r) => r.id === c.receivable_id)!;
const setPaid = (r: Receivable, paid: number) => {
  r.paid_cents = paid;
  r.open_cents = r.amount_cents - paid;
  r.status = paid === 0 ? "open" : paid < r.amount_cents ? "partially_paid" : "paid";
  r.version += 1;
};
const dayOf = (isoTs: string) => new Date(isoTs).toLocaleDateString("en-CA", { timeZone: TZ });

/** Baixa idempotente por cobrança (mesma regra de app.pay_settle). */
function settle(c: State["charges"][number], paidCents: number, paidAt: string): "entry" | "already_settled" | "receivable_cancelled" {
  const s = state();
  if (c.status === "paid") return "already_settled";
  const r = receivableOf(c);
  c.version += 1;
  if (r.status !== "open" && r.status !== "partially_paid") {
    Object.assign(c, { status: "paid", paid_at: paidAt, paid_cents: paidCents, settlement: "receivable_cancelled" });
    return "receivable_cancelled";
  }
  const amount = Math.min(paidCents, r.amount_cents - r.paid_cents);
  const entry = { id: id("e3000000"), charge_id: c.id, amount_cents: amount, reversal_of: null, received_at: paidAt };
  s.entries.push(entry);
  setPaid(r, r.paid_cents + amount);
  Object.assign(c, { status: "paid", paid_at: paidAt, paid_cents: paidCents, payment_entry_id: entry.id, settlement: "entry" });
  return "entry";
}
function ingest(eventId: string, kind: "charge.paid" | "charge.expired", externalId: string): SimPayResult {
  const s = state();
  if (s.events.has(eventId)) return { status: "pending", applied: 0, duplicates: 1 };
  s.events.add(eventId);
  const c = s.charges.find((x) => x.external_id === externalId);
  if (!c) return { status: "pending", applied: 0, duplicates: 0 };
  if (kind === "charge.paid") {
    const l = s.psp.get(externalId)!;
    const out = settle(c, l.amount_cents, l.paid_at ?? ts());
    return { status: c.status, applied: out === "already_settled" ? 0 : 1, duplicates: 0 };
  }
  if (c.status === "pending" || c.status === "unknown") {
    Object.assign(c, { status: "expired" });
    c.version += 1;
    return { status: "expired", applied: 1, duplicates: 0 };
  }
  return { status: c.status, applied: 0, duplicates: 0 };
}

export function createDemoPort(): PaymentsPort {
  return {
    kind: "demo",
    async openReceivables() {
      return clone(state().receivables.filter((r) => r.status === "open" || r.status === "partially_paid"));
    },
    async charges(): Promise<ChargesList> {
      const s = state();
      return { charges: [...s.charges].reverse().map(strip), refunds: clone([...s.refunds].reverse()), unknown: s.charges.filter((c) => c.status === "unknown").length };
    },
    createCharge(receivableId, provider, key) {
      return once(key, (): ChargeCreated => {
        const s = state();
        if (provider === "psp") fail("PROVIDER_UNAVAILABLE");
        const r = s.receivables.find((x) => x.id === receivableId) ?? fail("NOT_FOUND", "receivable_id");
        if (r.status !== "open" && r.status !== "partially_paid") fail("POLICY_REJECTED", "status");
        if (s.charges.some((c) => c.receivable_id === r.id && ["creating", "pending", "unknown"].includes(c.status))) fail("POLICY_REJECTED", "charge");
        const amount = r.amount_cents - r.paid_cents;
        const token = Array.from({ length: 43 }, () => "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_"[Math.floor(Math.random() * 64)]).join("");
        const c: State["charges"][number] = { id: id("e1000000"), receivable_id: r.id, customer_id: r.customer_id, provider, simulated: true, external_id: null, amount_cents: amount,
          description: r.description, status: "creating", pix_code: null, checkout_url: null, expires_at: null, paid_at: null, paid_cents: null, payment_entry_id: null,
          settlement: null, failure_reason: null, refund_status: null, created_at: ts(), version: 1, token };
        s.charges.push(c);
        // "Resposta do provedor": 99 falha, 98 sem resposta (primeira vez), senão pendente com Pix.
        if (amount % 100 === 99) Object.assign(c, { status: "failed", failure_reason: "amount_rejected", version: 2 });
        else if (amount % 100 === 98 && !s.unknownOnce.has(amount)) { s.unknownOnce.add(amount); Object.assign(c, { status: "unknown", version: 2 }); }
        else {
          const external_id = `sim-${c.id.slice(-12)}`;
          s.psp.set(external_id, { status: "pending", amount_cents: amount, paid_at: null });
          Object.assign(c, { status: "pending", external_id, pix_code: `00020126SIMULADO${external_id}5204000053039865802BR`, expires_at: new Date(s.clock + 60 * 60_000).toISOString(), version: 2 });
        }
        return { charge: strip(c), pay_url: `${window.location.origin}/pagar#t=${token}` };
      });
    },
    cancelCharge(charge, key) {
      return once(key, () => {
        const c = findCharge(charge.id);
        if (c.version !== charge.version) fail("STALE_VERSION");
        if (!["pending", "unknown", "creating"].includes(c.status)) fail("POLICY_REJECTED", "status");
        c.status = "cancelled";
        c.version += 1;
        const l = c.external_id ? state().psp.get(c.external_id) : null;
        if (l && l.status === "pending") l.status = "cancelled";
        return strip(c);
      });
    },
    refund(chargeId, reason, key) {
      return once(key, () => {
        const s = state();
        const c = findCharge(chargeId);
        if (c.status !== "paid") fail("POLICY_REJECTED", "status");
        if (s.refunds.some((f) => f.charge_id === c.id && f.status !== "failed")) fail("POLICY_REJECTED", "refund");
        const f: PaymentRefund = { id: id("e4000000"), charge_id: c.id, amount_cents: c.paid_cents ?? c.amount_cents, reason, status: "requested", external_id: null,
          reversal_entry_id: null, failure_reason: null, created_at: ts(), version: 1, charge_external_id: c.external_id, charge_provider: c.provider };
        s.refunds.push(f);
        const l = c.external_id ? s.psp.get(c.external_id) : null;
        if (!l || l.status !== "paid") { Object.assign(f, { status: "failed", failure_reason: "not_paid" }); c.refund_status = "failed"; return clone(f); }
        l.status = "refunded";
        const orig = s.entries.find((e) => e.id === c.payment_entry_id);
        if (orig) {
          const rev = { id: id("e3000000"), charge_id: c.id, amount_cents: orig.amount_cents, reversal_of: orig.id, received_at: ts() };
          s.entries.push(rev);
          const r = receivableOf(c);
          setPaid(r, r.paid_cents - orig.amount_cents);
          f.reversal_entry_id = rev.id;
        }
        Object.assign(f, { status: "done", external_id: `rf-${c.external_id}` });
        c.refund_status = "done";
        return clone(f);
      });
    },
    reconcile(provider, day, key) {
      return once(key, (): Reconciliation => {
        const s = state();
        const report = [...s.psp.entries()].filter(([, l]) => l.status === "paid" && l.paid_at && dayOf(l.paid_at) === day);
        const differences: Reconciliation["differences"] = [];
        let reportCents = 0;
        for (const [external_id, l] of report) {
          reportCents += l.amount_cents;
          const c = s.charges.find((x) => x.external_id === external_id);
          if (!c) { differences.push({ kind: "unknown_charge", external_id, amount_cents: l.amount_cents }); continue; }
          if (!c.payment_entry_id) { differences.push({ kind: "paid_without_entry", charge_id: c.id, external_id, amount_cents: l.amount_cents, charge_status: c.status, settlement: c.settlement }); continue; }
          const e = s.entries.find((x) => x.id === c.payment_entry_id)!;
          if (e.amount_cents !== l.amount_cents) differences.push({ kind: "amount_mismatch", charge_id: c.id, external_id, report_cents: l.amount_cents, entry_cents: e.amount_cents });
        }
        let ledgerCents = 0;
        for (const e of s.entries) {
          if (e.reversal_of || s.entries.some((x) => x.reversal_of === e.id) || dayOf(e.received_at) !== day) continue;
          ledgerCents += e.amount_cents;
          const c = s.charges.find((x) => x.id === e.charge_id)!;
          if (!report.some(([ext]) => ext === c.external_id)) differences.push({ kind: "entry_without_report", charge_id: c.id, external_id: c.external_id, entry_cents: e.amount_cents });
        }
        const rec: Reconciliation = { id: id("e5000000"), provider, day, report_count: report.length, report_paid_cents: reportCents, ledger_paid_cents: ledgerCents, differences, created_at: ts() };
        s.reconciliations.unshift(rec);
        return clone(rec);
      });
    },
    async reconciliations() {
      return clone(state().reconciliations);
    },
    async sync() {
      const s = state();
      const r = { checked: 0, settled: 0, closed: 0, still_unknown: 0 };
      for (const c of s.charges) {
        if (c.status !== "unknown" && !(c.status === "pending" && c.expires_at && Date.parse(c.expires_at) < s.clock)) continue;
        r.checked++;
        const l = c.external_id ? s.psp.get(c.external_id) : null;
        if (!l) { Object.assign(c, { status: "failed", failure_reason: "provider" }); c.version += 1; r.closed++; continue; }
        if (l.status === "paid" || l.status === "refunded") { settle(c, l.amount_cents, l.paid_at ?? ts()); r.settled++; }
        else if (l.status === "pending") r.still_unknown++;
        else { c.status = l.status; c.version += 1; r.closed++; }
      }
      save();
      return r;
    },
  };
}

/** Só para testes e para a tela da demonstração: adianta o relógio (vence cobranças). */
export function advanceDemoClock(ms: number) {
  state().clock += ms;
  save();
}

export function createDemoLinkPort(): PaymentLinkPort {
  const find = (token: string) => state().charges.find((c) => c.token === token) ?? fail("NOT_FOUND");
  return {
    kind: "demo",
    businessName: DEMO_BUSINESS,
    async view(token): Promise<LinkView> {
      const c = find(token);
      return { charge_id: c.id, business_name: DEMO_BUSINESS, description: c.description, amount_cents: c.amount_cents, provider: c.provider, simulated: true,
        status: c.status, pix_code: c.pix_code, checkout_url: c.checkout_url, expires_at: c.expires_at, paid_at: c.paid_at };
    },
    async simPay(token, outcome, notify) {
      const s = state();
      const c = find(token);
      if (c.status !== "pending") return { status: c.status, applied: 0, duplicates: 0 };
      const l = s.psp.get(c.external_id!)!;
      if (l.status !== "pending") return { status: c.status, applied: 0, duplicates: 0 };
      l.status = outcome;
      if (outcome === "paid") l.paid_at = ts();
      if (!notify) { save(); return { status: "pending", applied: 0, duplicates: 0 }; }
      const out = ingest(`sim:${c.external_id}:${outcome}`, outcome === "paid" ? "charge.paid" : "charge.expired", c.external_id!);
      save();
      return out;
    },
  };
}
