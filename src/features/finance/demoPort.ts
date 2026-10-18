// EMULAÇÃO do caixa (P07) para a demonstração sem servidor. Nada sai do navegador e nada persiste além
// da aba. Reproduz as regras do banco que a tela precisa explicar: recebimento nunca passa do saldo,
// estorno único e vinculado, pacote gera UM recebível, consumo debita crédito uma vez por evento e
// atendimento pago com crédito não vira cobrança. Os números são de exemplo e a tela diz isso.
import {
  DEFAULT_MESSAGES,
  ERROR_STATUS,
  type ErrorCode,
  type ExpenseEntry,
  FinanceCancelReceivableInput,
  FinanceChargeBookingInput,
  FinanceCreateReceivableInput,
  FinanceRecordExpenseInput,
  FinanceRecordPaymentInput,
  FinanceReverseExpenseInput,
  FinanceReversePaymentInput,
  PackageConsumeInput,
  type PackageDetail,
  PackageReverseInput,
  PackageSellInput,
  type PaymentRecord,
  type Receivable,
  RETRYABLE,
  type TimeRange,
  type UnchargedBooking,
} from "@contracts";
import { FIXED_NOW, FX, services as fixtureServices, tenantA } from "@contracts/fixtures.ts";
import type { z } from "zod";
import { ApiError } from "../../lib/api/client.ts";
import type { FinancePort } from "./port.ts";

function fail(code: ErrorCode, field?: string): never {
  throw new ApiError(code, DEFAULT_MESSAGES[code], ERROR_STATUS[code], crypto.randomUUID(), RETRYABLE.has(code), field);
}

function parse<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const r = schema.safeParse(input);
  if (!r.success) fail("VALIDATION_ERROR", r.error.issues[0]?.path.join("."));
  return r.data;
}

const stable = (v: unknown) =>
  JSON.stringify(v, (_k, x) =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : x,
  );

const id = (prefix: string, n: number) => `${prefix}-0000-4000-8000-${String(n).padStart(12, "0")}`;
const within = (iso: string, p: TimeRange) => Date.parse(iso) >= Date.parse(p.starts_at) && Date.parse(iso) < Date.parse(p.ends_at);

interface DemoBooking {
  booking_id: string;
  customer_id: string | null;
  service_id: string;
  starts_at: string;
  agreed_price_cents: number;
  completed_event_id: string;
}
interface Entry {
  id: string;
  package_id: string;
  booking_id: string | null;
  delta: -1 | 1;
  reason: "consume" | "reversal";
  reversal_of: string | null;
  event_id: string | null;
  created_at: string;
}
interface Pkg {
  id: string;
  customer_id: string;
  service_id: string;
  purchased_credits: number;
  total_price_cents: number;
  expires_at: string | null;
  created_at: string;
}

export const DEMO_FINANCE_CUSTOMERS = [
  { id: FX.customers.abInA, name: "Cliente Exemplo Ana" },
  { id: FX.customers.guestInA, name: "Cliente Exemplo Bruno" },
];

export function createDemoPort(): FinancePort {
  const tz = tenantA.timezone;
  const now = new Date(FIXED_NOW);
  const nowIso = () => now.toISOString();
  const services = fixtureServices.filter((s) => s.tenant_id === FX.tenants.A);
  let seq = 100;
  const next = (prefix: string) => id(prefix, ++seq);

  // Atendimentos concluídos de exemplo (segunda 19/10), ainda sem cobrança.
  const bookings: DemoBooking[] = [
    { booking_id: id("60000000", 101), customer_id: FX.customers.abInA, service_id: FX.services.corteA,
      starts_at: "2026-10-19T17:00:00Z", agreed_price_cents: 6000, completed_event_id: id("65000000", 1) },
    { booking_id: id("60000000", 105), customer_id: FX.customers.guestInA, service_id: FX.services.barbaA,
      starts_at: "2026-10-19T19:30:00Z", agreed_price_cents: 4000, completed_event_id: id("65000000", 2) },
  ];
  const receivables: Receivable[] = [];
  const payments: PaymentRecord[] = [];
  const expenses: ExpenseEntry[] = [];
  const packages: Pkg[] = [];
  const entries: Entry[] = [];
  const idem = new Map<string, { hash: string; result: unknown }>();

  function once<T>(op: string, key: string, input: unknown, run: () => T): T {
    const k = `${op}:${key}`;
    const prior = idem.get(k);
    if (prior) {
      if (prior.hash !== stable(input)) fail("IDEMPOTENCY_MISMATCH");
      return structuredClone(prior.result) as T;
    }
    const result = run();
    idem.set(k, { hash: stable(input), result: structuredClone(result) });
    return result;
  }

  const delay = <T>(v: T) => Promise.resolve(structuredClone(v));
  const receivable = (rid: string) => receivables.find((r) => r.id === rid) ?? fail("NOT_FOUND");
  const balance = (pid: string) => {
    const p = packages.find((x) => x.id === pid) ?? fail("NOT_FOUND", "package_id");
    return {
      package_id: p.id,
      purchased_credits: p.purchased_credits,
      remaining_credits: p.purchased_credits + entries.filter((e) => e.package_id === pid).reduce((s, e) => s + e.delta, 0),
      expires_at: p.expires_at,
    };
  };
  const consumed = (bookingId: string) =>
    entries.some((e) => e.booking_id === bookingId && e.reason === "consume" && !entries.some((r) => r.reversal_of === e.id));
  const activeReceivable = (bookingId: string) => receivables.some((r) => r.booking_id === bookingId && r.status !== "cancelled");
  const setPaid = (r: Receivable, paid: number) => {
    r.paid_cents = paid;
    r.open_cents = r.amount_cents - paid;
    r.status = paid === 0 ? "open" : paid < r.amount_cents ? "partially_paid" : "paid";
    r.version += 1;
  };
  const newReceivable = (fields: Pick<Receivable, "customer_id" | "booking_id" | "package_id" | "description" | "amount_cents" | "due_at">): Receivable => {
    const r: Receivable = { id: next("62000000"), paid_cents: 0, open_cents: fields.amount_cents, status: "open", version: 1, created_at: nowIso(), ...fields };
    receivables.push(r);
    return r;
  };
  function pay(r: Receivable, amount: number, method: PaymentRecord["method"], receivedAt: string): PaymentRecord {
    if (Date.parse(receivedAt) > now.getTime() + 5 * 60_000) fail("VALIDATION_ERROR", "received_at");
    if (r.status !== "open" && r.status !== "partially_paid") fail("POLICY_REJECTED", "status");
    if (r.paid_cents + amount > r.amount_cents) fail("POLICY_REJECTED", "amount_cents");
    const p: PaymentRecord = { id: next("63000000"), tenant_id: FX.tenants.A, customer_id: r.customer_id, amount_cents: amount,
      method, source: "manual", received_at: receivedAt, reversal_of: null, receivable_id: r.id, reversed: false };
    payments.push(p);
    setPaid(r, r.paid_cents + amount);
    return p;
  }

  // Histórico de exemplo do mês: um corte pago no dia 16, uma despesa e um pacote quitado.
  {
    const r = newReceivable({ customer_id: FX.customers.guestInA, booking_id: null, package_id: null, description: "Corte",
      amount_cents: 6000, due_at: "2026-10-16T15:00:00Z" });
    pay(r, 6000, "pix", "2026-10-16T15:40:00Z");
    expenses.push({ id: next("64000000"), amount_cents: 1500, paid_at: "2026-10-15T13:00:00Z", category: "supplies",
      description: "Lâminas", reversal_of: null, reversed: false });
    const pkg: Pkg = { id: id("66000000", 1), customer_id: FX.customers.abInA, service_id: FX.services.corteA,
      purchased_credits: 4, total_price_cents: 20000, expires_at: "2027-01-31T23:59:59-03:00", created_at: "2026-10-05T14:00:00Z" };
    packages.push(pkg);
    const pr = newReceivable({ customer_id: pkg.customer_id, booking_id: null, package_id: pkg.id, description: "Pacote 4 × Corte",
      amount_cents: 20000, due_at: pkg.created_at });
    pay(pr, 20000, "card", "2026-10-05T14:05:00Z");
  }

  return {
    kind: "demo",
    now: () => new Date(now),
    base: () => delay({ timezone: tz, customers: DEMO_FINANCE_CUSTOMERS, services }),

    summary(period, timezone) {
      const live = <T extends { id: string; reversal_of: string | null }>(list: T[], at: (x: T) => string) =>
        list.filter((x) => x.reversal_of === null && within(at(x), period) && !list.some((y) => y.reversal_of === x.id));
      const received = live(payments, (p) => p.received_at);
      const spent = live(expenses, (e) => e.paid_at);
      return delay({
        period, timezone,
        received_cents: received.reduce((s, p) => s + p.amount_cents, 0),
        spent_cents: spent.reduce((s, e) => s + e.amount_cents, 0),
        receivable_open_cents: receivables.filter((r) => r.status === "open" || r.status === "partially_paid").reduce((s, r) => s + r.open_cents, 0),
        records_count: received.length + spent.length,
        as_of: nowIso(),
        coverage_note: "Só o que foi registrado manualmente na Tinindo. Estornos anulam o registro original. Não é lucro nem saldo bancário.",
      });
    },
    ledger(period) {
      return delay({
        receivables: receivables.filter((r) => r.status === "open" || r.status === "partially_paid" || within(r.created_at, period)),
        payments: payments.filter((p) => within(p.received_at, period)).map((p) => ({ ...p, reversed: payments.some((x) => x.reversal_of === p.id) }))
          .sort((a, b) => b.received_at.localeCompare(a.received_at)),
        expenses: expenses.filter((e) => within(e.paid_at, period)).map((e) => ({ ...e, reversed: expenses.some((x) => x.reversal_of === e.id) }))
          .sort((a, b) => b.paid_at.localeCompare(a.paid_at)),
      });
    },
    uncharged(period) {
      const list: UnchargedBooking[] = bookings
        .filter((b) => within(b.starts_at, period) && !activeReceivable(b.booking_id) && !consumed(b.booking_id))
        .map((b) => ({
          ...b,
          package_ids: packages
            .filter((p) => p.customer_id === b.customer_id && p.service_id === b.service_id && balance(p.id).remaining_credits > 0
              && (!p.expires_at || Date.parse(p.expires_at) >= Date.parse(b.starts_at)))
            .map((p) => p.id),
        }));
      return delay(list);
    },
    packages() {
      const list: PackageDetail[] = packages.map((p) => ({
        ...balance(p.id), customer_id: p.customer_id, service_id: p.service_id, total_price_cents: p.total_price_cents,
        created_at: p.created_at,
        entries: entries.filter((e) => e.package_id === p.id).map((e) => ({
          id: e.id, booking_id: e.booking_id, delta: e.delta, reason: e.reason, reversal_of: e.reversal_of,
          created_at: e.created_at, reversed: entries.some((r) => r.reversal_of === e.id),
        })).reverse(),
      }));
      return delay(list.reverse());
    },

    async createReceivable(raw, key) {
      const i = parse(FinanceCreateReceivableInput, raw);
      return delay(once("finance.create_receivable", key, i, () =>
        newReceivable({ customer_id: i.customer_id, booking_id: null, package_id: null, description: i.description, amount_cents: i.amount_cents, due_at: i.due_at })));
    },
    async chargeBooking(raw, key) {
      const i = parse(FinanceChargeBookingInput, raw);
      return delay(once("finance.charge_booking", key, i, () => {
        const b = bookings.find((x) => x.booking_id === i.booking_id) ?? fail("NOT_FOUND");
        if (consumed(b.booking_id)) fail("POLICY_REJECTED", "package");
        if (activeReceivable(b.booking_id)) fail("POLICY_REJECTED", "booking_id");
        const svc = services.find((s) => s.id === b.service_id);
        return newReceivable({ customer_id: b.customer_id, booking_id: b.booking_id, package_id: null,
          description: svc?.name ?? "Atendimento", amount_cents: b.agreed_price_cents, due_at: i.due_at ?? b.starts_at });
      }));
    },
    async cancelReceivable(raw, key) {
      const i = parse(FinanceCancelReceivableInput, raw);
      return delay(once("finance.cancel_receivable", key, i, () => {
        const r = receivable(i.receivable_id);
        if (r.version !== i.expected_version) fail("STALE_VERSION");
        if (r.status !== "open" || r.package_id) fail("POLICY_REJECTED", "status");
        r.status = "cancelled";
        r.open_cents = 0;
        r.version += 1;
        return { ...r };
      }));
    },
    async recordPayment(raw, key) {
      const i = parse(FinanceRecordPaymentInput, raw);
      return delay(once("finance.record_payment", key, i, () => pay(receivable(i.receivable_id), i.amount_cents, i.method, i.received_at)));
    },
    async reversePayment(raw, key) {
      const i = parse(FinanceReversePaymentInput, raw);
      once("finance.reverse_payment", key, i, () => {
        const p = payments.find((x) => x.id === i.payment_id) ?? fail("NOT_FOUND");
        if (p.reversal_of || payments.some((x) => x.reversal_of === p.id)) fail("POLICY_REJECTED", "reversal_of");
        payments.push({ ...p, id: next("63000000"), received_at: nowIso(), reversal_of: p.id, reversed: false });
        const r = receivable(p.receivable_id);
        setPaid(r, r.paid_cents - p.amount_cents);
        return true;
      });
      return delay(undefined);
    },
    async recordExpense(raw, key) {
      const i = parse(FinanceRecordExpenseInput, raw);
      return delay(once("finance.record_expense", key, i, () => {
        if (Date.parse(i.paid_at) > now.getTime() + 5 * 60_000) fail("VALIDATION_ERROR", "paid_at");
        const e: ExpenseEntry = { id: next("64000000"), amount_cents: i.amount_cents, paid_at: i.paid_at, category: i.category,
          description: i.description, reversal_of: null, reversed: false };
        expenses.push(e);
        return e;
      }));
    },
    async reverseExpense(raw, key) {
      const i = parse(FinanceReverseExpenseInput, raw);
      once("finance.reverse_expense", key, i, () => {
        const e = expenses.find((x) => x.id === i.expense_id) ?? fail("NOT_FOUND");
        if (e.reversal_of || expenses.some((x) => x.reversal_of === e.id)) fail("POLICY_REJECTED", "reversal_of");
        expenses.push({ ...e, id: next("64000000"), paid_at: nowIso(), reversal_of: e.id });
        return true;
      });
      return delay(undefined);
    },
    async sellPackage(raw, key) {
      const i = parse(PackageSellInput, raw);
      once("package.sell", key, i, () => {
        const svc = services.find((s) => s.id === i.service_id && s.active) ?? fail("NOT_FOUND", "service_id");
        if (!DEMO_FINANCE_CUSTOMERS.some((c) => c.id === i.customer_id)) fail("NOT_FOUND", "customer_id");
        const p: Pkg = { id: next("66000000"), customer_id: i.customer_id, service_id: i.service_id, purchased_credits: i.credits,
          total_price_cents: i.total_price_cents, expires_at: i.expires_at, created_at: nowIso() };
        packages.push(p);
        newReceivable({ customer_id: p.customer_id, booking_id: null, package_id: p.id, description: `Pacote ${i.credits} × ${svc.name}`,
          amount_cents: i.total_price_cents, due_at: nowIso() });
        return true;
      });
      return delay(undefined);
    },
    async consumePackage(raw, key) {
      const i = parse(PackageConsumeInput, raw);
      return delay(once("package.consume", key, i, () => {
        const pkg = packages.find((p) => p.id === i.package_id) ?? fail("NOT_FOUND", "package_id");
        const prior = entries.find((e) => e.event_id === i.event_id);
        if (prior) {
          if (prior.package_id !== pkg.id) fail("POLICY_REJECTED", "event_id");
          return balance(pkg.id);
        }
        const b = bookings.find((x) => x.booking_id === i.booking_id) ?? fail("NOT_FOUND", "booking_id");
        if (b.completed_event_id !== i.event_id) fail("POLICY_REJECTED", "event_id");
        if (b.customer_id !== pkg.customer_id || b.service_id !== pkg.service_id) fail("POLICY_REJECTED", "package_id");
        if (activeReceivable(b.booking_id)) fail("POLICY_REJECTED", "booking_id");
        if (consumed(b.booking_id)) fail("POLICY_REJECTED", "booking_id");
        if (balance(pkg.id).remaining_credits < 1) fail("POLICY_REJECTED", "remaining_credits");
        entries.push({ id: next("67000000"), package_id: pkg.id, booking_id: b.booking_id, delta: -1, reason: "consume",
          reversal_of: null, event_id: i.event_id, created_at: nowIso() });
        return balance(pkg.id);
      }));
    },
    async reversePackage(raw, key) {
      const i = parse(PackageReverseInput, raw);
      once("package.reverse", key, i, () => {
        const e = entries.find((x) => x.id === i.entry_id) ?? fail("NOT_FOUND");
        if (e.reason !== "consume" || entries.some((x) => x.reversal_of === e.id)) fail("POLICY_REJECTED", "entry_id");
        entries.push({ id: next("67000000"), package_id: e.package_id, booking_id: e.booking_id, delta: 1, reason: "reversal",
          reversal_of: e.id, event_id: null, created_at: nowIso() });
        return true;
      });
      return delay(undefined);
    },
  };
}
