// EMULAÇÃO de Contas para a demonstração sem servidor. Mesmas regras do banco que a tela explica: pagar cria uma
// despesa no Caixa e pagar de novo é recusado; estorno uma vez e a conta volta a ficar em aberto; mensal gera 12 meses;
// conciliação guarda a diferença (a última vale); demonstrativo de caixa com cobertura, que não é DRE.
import { type AccCategory, type AccEntry, type AccPayable, type AccReconciliationRow, type AccSeries, type AccStatement, DEFAULT_MESSAGES, ERROR_STATUS,
  type ErrorCode, RETRYABLE } from "@contracts";
import { FIXED_NOW } from "@contracts/fixtures.ts";
import { ApiError } from "../../lib/api/client.ts";
import { addDays, BASE_LABEL, localToday } from "./labels.ts";
import type { AccountsBase, AccountsPort, Method, Source } from "./port.ts";

function fail(code: ErrorCode, field?: string): never {
  throw new ApiError(code, DEFAULT_MESSAGES[code], ERROR_STATUS[code], crypto.randomUUID(), RETRYABLE.has(code), field);
}
const clone = <T>(v: T): T => structuredClone(v);
const TZ = "America/Sao_Paulo";

interface Income { id: string; at: string; amount: number; description: string; method: Method; source: Source; origin: string }
interface Expense { id: string; at: string; amount: number; description: string; base: string; reversed: boolean }
interface Payable { p: Omit<AccPayable, "status" | "paid_at" | "expense_entry_id" | "reversals"> & { cancelled: boolean }; expense: string | null; paidAt: string | null; reversals: number }
interface State {
  categories: AccCategory[];
  classes: Map<string, string>;
  incomes: Income[];
  expenses: Expense[];
  payables: Payable[];
  series: AccSeries[];
  recs: { day: string; method: Method; source: Source; statement: number; ledger: number; at: string }[];
  idem: Map<string, unknown>;
  seq: number;
  clock: number;
}
let shared: State | null = null;
const id = (p: string) => `${p}-0000-4000-8000-${String(++shared!.seq).padStart(12, "0")}`;
const ts = () => new Date((shared!.clock += 1000)).toISOString().replace(/\.\d{3}Z$/, "Z");
const today = () => localToday(new Date(state().clock), TZ);
const dayOf = (at: string) => localToday(new Date(at), TZ);

function seed(s: State) {
  const at = (d: string, hh = "15") => `${d}T${hh}:00:00Z`;
  s.incomes.push(
    { id: id("d1000000"), at: at("2026-10-14"), amount: 6000, description: "Corte · Ana Beatriz", method: "pix", source: "manual", origin: "services" },
    { id: id("d1000000"), at: at("2026-10-14", "17"), amount: 4000, description: "Barba · Carlos", method: "cash", source: "manual", origin: "services" },
    { id: id("d1000000"), at: at("2026-10-16"), amount: 20000, description: "Assinatura Corte mensal · ciclo 1", method: "pix", source: "provider", origin: "packages" },
  );
  s.expenses.push({ id: id("d2000000"), at: at("2026-10-12"), amount: 3500, description: "Compra de materiais", base: "supplies", reversed: false });
  const rent: Payable = { p: { id: id("d3000000"), series_id: null, description: "Aluguel do salão", amount_cents: 150000, due_on: "2026-10-10", base_category: "rent",
    category_id: null, category_name: null, supplier: "Imobiliária (exemplo)", version: 2, cancelled: false }, expense: null, paidAt: null, reversals: 0 };
  const exp: Expense = { id: id("d2000000"), at: at("2026-10-10"), amount: 150000, description: "Aluguel do salão", base: "rent", reversed: false };
  s.expenses.push(exp);
  Object.assign(rent, { expense: exp.id, paidAt: exp.at });
  s.payables.push(rent, { p: { id: id("d3000000"), series_id: null, description: "Conta de luz", amount_cents: 18000, due_on: "2026-10-25", base_category: "utilities",
    category_id: null, category_name: null, supplier: null, version: 1, cancelled: false }, expense: null, paidAt: null, reversals: 0 });
  makeSeries(s, "Internet", 12000, "utilities", null, "2026-10-15");
}
function makeSeries(s: State, description: string, amount: number, base: AccPayable["base_category"], categoryId: string | null, due: string) {
  const ser: AccSeries = { id: id("d4000000"), description, amount_cents: amount, base_category: base, category_id: categoryId, supplier: null,
    day_of_month: Number(due.slice(8, 10)), starts_on: due, generated_until: due, active: true, version: 1 };
  s.series.push(ser);
  materialize(s, ser, 12);
  return ser;
}
function materialize(s: State, ser: AccSeries, months: number) {
  let n = 0;
  const [y0, m0] = [Number(ser.generated_until.slice(0, 4)), Number(ser.generated_until.slice(5, 7))];
  const startOffset = s.payables.some((x) => x.p.series_id === ser.id) ? 1 : 0;
  for (let k = startOffset; k < startOffset + months; k++) {
    const mm = m0 - 1 + k;
    const due = `${y0 + Math.floor(mm / 12)}-${String((mm % 12) + 1).padStart(2, "0")}-${String(ser.day_of_month).padStart(2, "0")}`;
    if (s.payables.some((x) => x.p.series_id === ser.id && x.p.due_on === due)) continue;
    s.payables.push({ p: { id: id("d3000000"), series_id: ser.id, description: ser.description, amount_cents: ser.amount_cents, due_on: due, base_category: ser.base_category,
      category_id: ser.category_id, category_name: s.categories.find((c) => c.id === ser.category_id)?.name ?? null, supplier: ser.supplier, version: 1, cancelled: false },
      expense: null, paidAt: null, reversals: 0 });
    ser.generated_until = due;
    n++;
  }
  ser.version += 1;
  return n;
}
function state(): State {
  if (!shared) {
    shared = { categories: [], classes: new Map(), incomes: [], expenses: [], payables: [], series: [], recs: [], idem: new Map(), seq: 0, clock: Date.parse(FIXED_NOW) };
    seed(shared);
  }
  return shared;
}
/** Só para testes. */
export function resetDemoState() {
  shared = null;
}
const once = async <T>(key: string, run: () => T): Promise<T> => {
  const s = state();
  if (s.idem.has(key)) return clone(s.idem.get(key)) as T;
  const v = run();
  s.idem.set(key, clone(v));
  return clone(v);
};
const view = (x: Payable): AccPayable => {
  const { cancelled, ...p } = x.p;
  return { ...clone(p), status: cancelled ? "cancelled" : x.expense ? "paid" : p.due_on < today() ? "overdue" : "open", paid_at: x.paidAt, expense_entry_id: x.expense,
    reversals: x.reversals };
};
const find = (pid: string) => state().payables.find((x) => x.p.id === pid) ?? fail("NOT_FOUND");
const liveExpenses = () => state().expenses.filter((e) => !e.reversed);
const inMonth = (at: string, month: string) => dayOf(at).startsWith(month);
const ledger = (day: string, method: Method, source: Source) =>
  state().incomes.filter((i) => dayOf(i.at) === day && i.method === method && i.source === source).reduce((t, i) => t + i.amount, 0);

export function createDemoPort(): AccountsPort {
  return {
    kind: "demo",
    async base(): Promise<AccountsBase> {
      return { timezone: TZ, today: today() };
    },
    async categories() {
      return clone(state().categories);
    },
    saveCategory(input, key) {
      return once(key, () => {
        const s = state();
        const name = input.name.trim();
        if (s.categories.some((c) => c.id !== input.category_id && c.active && c.kind === input.kind && c.name.toLowerCase() === name.toLowerCase())) fail("POLICY_REJECTED", "name");
        if (input.category_id) {
          const c = s.categories.find((x) => x.id === input.category_id) ?? fail("NOT_FOUND");
          if (c.version !== input.expected_version) fail("STALE_VERSION");
          Object.assign(c, { name, base: c.kind === "expense" ? input.base ?? c.base : null, active: input.active ?? c.active, version: c.version + 1 });
          return clone(c);
        }
        const c: AccCategory = { id: id("d5000000"), kind: input.kind, name, base: input.kind === "expense" ? input.base ?? "other" : null, active: input.active ?? true, version: 1 };
        s.categories.push(c);
        return clone(c);
      });
    },
    async classify(entry, categoryId, key) {
      await once(key, () => {
        const s = state();
        if (categoryId !== null) {
          const c = s.categories.find((x) => x.id === categoryId && x.active);
          if (!c || c.kind !== (entry.entry_kind === "payment" ? "income" : "expense")) fail("NOT_FOUND", "category_id");
          s.classes.set(entry.entry_id, categoryId);
        } else s.classes.delete(entry.entry_id);
        return true;
      });
    },
    async entries(month) {
      const s = state();
      const out: AccEntry[] = [
        ...s.incomes.filter((i) => inMonth(i.at, month)).map((i) => ({ entry_kind: "payment" as const, entry_id: i.id, at: i.at, amount_cents: i.amount, description: i.description,
          method: i.method, source: i.source, base: i.origin, category_id: s.classes.get(i.id) ?? null })),
        ...liveExpenses().filter((e) => inMonth(e.at, month)).map((e) => ({ entry_kind: "expense" as const, entry_id: e.id, at: e.at, amount_cents: e.amount, description: e.description,
          method: null, source: null, base: e.base, category_id: s.classes.get(e.id) ?? null })),
      ];
      return out.sort((a, b) => b.at.localeCompare(a.at));
    },
    async payables(from, to) {
      const s = state();
      const list = s.payables.filter((x) => (x.p.due_on >= from && x.p.due_on <= to) || (x.p.due_on < from && !x.p.cancelled && !x.expense))
        .sort((a, b) => a.p.due_on.localeCompare(b.p.due_on));
      return { today: today(), payables: list.map(view), series: clone(s.series) };
    },
    savePayable(input, key) {
      return once(key, () => {
        const s = state();
        const cat = input.category_id ? s.categories.find((c) => c.id === input.category_id && c.kind === "expense" && c.active) ?? fail("NOT_FOUND", "category_id") : null;
        const base = (cat?.base ?? input.base_category ?? "other") as AccPayable["base_category"];
        if (!(input.amount_cents >= 1)) fail("VALIDATION_ERROR", "amount_cents");
        if (input.payable_id) {
          const x = find(input.payable_id);
          if (x.p.version !== input.expected_version) fail("STALE_VERSION");
          if (x.p.cancelled || x.expense) fail("POLICY_REJECTED", "status");
          Object.assign(x.p, { description: input.description.trim(), amount_cents: input.amount_cents, due_on: input.due_on, base_category: base, category_id: cat?.id ?? null,
            category_name: cat?.name ?? null, supplier: input.supplier?.trim() || null, version: x.p.version + 1 });
          return { payable: view(x), created: 1 };
        }
        if (input.monthly) {
          if (Number(input.due_on.slice(8, 10)) > 28) fail("VALIDATION_ERROR", "due_on");
          const ser = makeSeries(s, input.description.trim(), input.amount_cents, base, cat?.id ?? null, input.due_on);
          const first = s.payables.filter((x) => x.p.series_id === ser.id).sort((a, b) => a.p.due_on.localeCompare(b.p.due_on))[0]!;
          return { payable: view(first), created: 12 };
        }
        const x: Payable = { p: { id: id("d3000000"), series_id: null, description: input.description.trim(), amount_cents: input.amount_cents, due_on: input.due_on, base_category: base,
          category_id: cat?.id ?? null, category_name: cat?.name ?? null, supplier: input.supplier?.trim() || null, version: 1, cancelled: false }, expense: null, paidAt: null, reversals: 0 };
        s.payables.push(x);
        return { payable: view(x), created: 1 };
      });
    },
    pay(p, paidAt, key) {
      return once(key, () => {
        const x = find(p.id);
        if (x.p.version !== p.version) fail("STALE_VERSION");
        if (x.p.cancelled) fail("POLICY_REJECTED", "status");
        if (x.expense) fail("POLICY_REJECTED", "paid");
        const e: Expense = { id: id("d2000000"), at: paidAt, amount: x.p.amount_cents, description: x.p.description, base: x.p.base_category, reversed: false };
        state().expenses.push(e);
        if (x.p.category_id) state().classes.set(e.id, x.p.category_id);
        Object.assign(x, { expense: e.id, paidAt });
        x.p.version += 1;
        return view(x);
      });
    },
    reverse(p, key) {
      return once(key, () => {
        const x = find(p.id);
        if (x.p.version !== p.version) fail("STALE_VERSION");
        if (!x.expense) fail("POLICY_REJECTED", "not_paid");
        state().expenses.find((e) => e.id === x.expense)!.reversed = true;
        Object.assign(x, { expense: null, paidAt: null, reversals: x.reversals + 1 });
        x.p.version += 1;
        ts();
        return view(x);
      });
    },
    cancel(p, key) {
      return once(key, () => {
        const x = find(p.id);
        if (x.p.version !== p.version) fail("STALE_VERSION");
        if (x.p.cancelled || x.expense) fail("POLICY_REJECTED", "status");
        Object.assign(x.p, { cancelled: true, version: x.p.version + 1 });
        return view(x);
      });
    },
    updateSeries(input, action, key) {
      return once(key, () => {
        const s = state();
        const ser = s.series.find((x) => x.id === input.id) ?? fail("NOT_FOUND");
        if (ser.version !== input.version) fail("STALE_VERSION");
        if (!ser.active) fail("POLICY_REJECTED", "status");
        let affected = 0;
        if (action === "extend") affected = materialize(s, ser, 12);
        else {
          for (const x of s.payables) if (x.p.series_id === ser.id && !x.p.cancelled && !x.expense && x.p.due_on >= today()) { Object.assign(x.p, { cancelled: true, version: x.p.version + 1 }); affected++; }
          ser.active = false;
          ser.version += 1;
        }
        return { series: clone(ser), affected };
      });
    },
    async reconciliation(day): Promise<AccReconciliationRow[]> {
      const s = state();
      const keys = new Map<string, { method: Method; source: Source }>();
      for (const i of s.incomes) if (dayOf(i.at) === day) keys.set(`${i.source}:${i.method}`, { method: i.method, source: i.source });
      for (const r of s.recs) if (r.day === day) keys.set(`${r.source}:${r.method}`, { method: r.method, source: r.source });
      return [...keys.values()].sort((a, b) => `${a.source}${a.method}`.localeCompare(`${b.source}${b.method}`)).map((k) => {
        const last = s.recs.filter((r) => r.day === day && r.method === k.method && r.source === k.source).at(-1);
        const led = ledger(day, k.method, k.source);
        return { method: k.method, source: k.source, ledger_cents: led, entries: s.incomes.filter((i) => dayOf(i.at) === day && i.method === k.method && i.source === k.source).length,
          partner_paid_cents: k.source === "provider" ? led : null, partner_differences: k.source === "provider" ? 0 : null,
          statement: last ? { statement_cents: last.statement, ledger_cents: last.ledger, difference_cents: last.statement - last.ledger, checked_at: last.at } : null };
      });
    },
    reconcile(day, method, source, statementCents, key) {
      return once(key, () => {
        if (day > today()) fail("VALIDATION_ERROR", "day");
        const led = ledger(day, method, source);
        state().recs.push({ day, method, source, statement: statementCents, ledger: led, at: ts() });
        return statementCents - led;
      });
    },
    async statement(month): Promise<AccStatement> {
      const s = state();
      const first = `${month}-01`;
      const [y, m] = [Number(month.slice(0, 4)), Number(month.slice(5, 7))];
      const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
      const last = addDays(next, -1);
      const group = (rows: { key: string; label: string; cents: number }[]) => {
        const m = new Map<string, { key: string; label: string; cents: number; entries: number }>();
        for (const r of rows) { const g = m.get(r.key) ?? { ...r, cents: 0, entries: 0 }; g.cents += r.cents; g.entries += 1; m.set(r.key, g); }
        return [...m.values()].sort((a, b) => b.cents - a.cents || a.label.localeCompare(b.label));
      };
      const cat = (eid: string) => s.categories.find((c) => c.id === s.classes.get(eid));
      const inc = s.incomes.filter((i) => inMonth(i.at, month));
      const out = liveExpenses().filter((e) => inMonth(e.at, month));
      const income = group(inc.map((i) => ({ key: cat(i.id)?.id ?? `origin:${i.origin}`, label: cat(i.id)?.name ?? (i.origin === "other" ? "Outras receitas" : BASE_LABEL[i.origin]!), cents: i.amount })));
      const expenses = group(out.map((e) => ({ key: cat(e.id)?.id ?? `base:${e.base}`, label: cat(e.id)?.name ?? BASE_LABEL[e.base]!, cents: e.amount })));
      const inCents = inc.reduce((t, i) => t + i.amount, 0);
      const outCents = out.reduce((t, e) => t + e.amount, 0);
      const unpaid = s.payables.filter((x) => !x.p.cancelled && !x.expense && x.p.due_on.startsWith(month));
      const days = new Set(inc.filter((i) => !s.recs.some((r) => r.day === dayOf(i.at) && r.method === i.method && r.source === i.source)).map((i) => dayOf(i.at)));
      return { basis: "cash", period: { month, starts_at: `${first}T03:00:00Z`, ends_at: `${next}T03:00:00Z`, first_day: first, last_day: last, timezone: TZ },
        in_cents: inCents, out_cents: outCents, net_cents: inCents - outCents, income, expenses,
        coverage: { uncharged_bookings: month === "2026-10" ? 1 : 0, uncharged_cents: month === "2026-10" ? 6000 : 0, receivables_open_cents: 9000,
          payables_unpaid: unpaid.length, payables_unpaid_cents: unpaid.reduce((t, x) => t + x.p.amount_cents, 0),
          unclassified_entries: [...inc, ...out].filter((x) => !s.classes.has(x.id)).length, days_unreconciled: days.size, fiscal_authorized: 0, fiscal_authorized_cents: 0 },
        as_of: new Date(s.clock).toISOString().replace(/\.\d{3}Z$/, "Z"),
        note: "Demonstrativo gerencial de caixa: o que foi registrado como recebido e pago no mês, no fuso do negócio. Estornos anulam o lançamento original. Não é DRE nem saldo bancário." };
    },
  };
}
