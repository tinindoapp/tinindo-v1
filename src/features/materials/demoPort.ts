// EMULAÇÃO de Materiais para a demonstração sem servidor. Mesmas regras do banco que a tela explica: custo médio; compra
// entra pelo valor pago; consumo por atendimento concluído, um ativo por atendimento, tudo ou nada; estorno uma vez e
// devolve exato; estoque nunca negativo; margem real só sobre atendimentos com consumo registrado.
import { DEFAULT_MESSAGES, ERROR_STATUS, type ErrorCode, RETRYABLE } from "@contracts";
import { FIXED_NOW, FX, services as fixtureServices, tenantA } from "@contracts/fixtures.ts";
import { ApiError } from "../../lib/api/client.ts";
import type { MarginReport, MaterialBooking, MaterialConsumption, MaterialItem, MaterialPurchase, MaterialsBase, MaterialsPort, MaterialUsage } from "./port.ts";

function fail(code: ErrorCode, field?: string): never {
  throw new ApiError(code, DEFAULT_MESSAGES[code], ERROR_STATUS[code], crypto.randomUUID(), RETRYABLE.has(code), field);
}
const clone = <T>(v: T): T => structuredClone(v);
const SERVICES = fixtureServices.filter((s) => s.tenant_id === FX.tenants.A);
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
/** Quantidades em milésimos inteiros (3 casas, como o numeric(14,3) do banco). */
const milli = (q: number) => Math.round(q * 1000);

interface Item { id: string; name: string; kind: MaterialItem["kind"]; unit: MaterialItem["unit"]; active: boolean; qty: number; value: number; min: number | null; version: number; moved: boolean }
interface Booking { id: string; starts_at: string; service_id: string; customer_name: string; price: number }
interface State {
  items: Item[];
  usage: MaterialUsage[];
  purchases: MaterialPurchase[];
  consumptions: MaterialConsumption[];
  bookings: Booking[];
  idem: Map<string, unknown>;
  seq: number;
  clock: number;
}
let shared: State | null = null;
const id = (p: string) => `${p}-0000-4000-8000-${String(++shared!.seq).padStart(12, "0")}`;
const ts = () => iso((shared!.clock += 1000));

const view = (i: Item): MaterialItem => ({ id: i.id, name: i.name, kind: i.kind, unit: i.unit, active: i.active, on_hand: i.qty / 1000, stock_value_cents: i.value,
  unit_cost_cents: i.qty > 0 ? Math.round((i.value * 1000) / i.qty) : null, min_qty: i.min, low_stock: i.min !== null && i.qty / 1000 < i.min, version: i.version });
const findItem = (itemId: string) => state().items.find((i) => i.id === itemId);
/** Saída pelo custo médio: a última unidade leva o valor restante. Item travado = esta função é síncrona. */
function out(i: Item, q: number): number {
  if (i.qty - q < 0) fail("POLICY_REJECTED", "stock");
  const v = i.qty - q === 0 ? i.value : Math.min(i.value, Math.round((i.value * q) / i.qty));
  i.qty -= q;
  i.value -= v;
  i.version += 1;
  i.moved = true;
  return v;
}
function into(i: Item, q: number, v: number) {
  i.qty += q;
  i.value += v;
  i.version += 1;
  i.moved = true;
}

function seed(s: State) {
  const mk = (name: string, unit: Item["unit"], kind: Item["kind"], min: number | null): Item => {
    const i: Item = { id: id("c1000000"), name, kind, unit, active: true, qty: 0, value: 0, min, version: 1, moved: false };
    s.items.push(i);
    return i;
  };
  const sh = mk("Shampoo", "ml", "consumable", 200);
  const po = mk("Pomada", "un", "product", 2);
  mk("Toalha descartável", "un", "consumable", null);
  s.usage.push({ service_id: FX.services.corteA, item_id: sh.id, quantity: 20 }, { service_id: FX.services.corteA, item_id: po.id, quantity: 1 });
  const at = iso(s.clock - 3 * 86_400_000);
  into(sh, milli(1000), 5000);
  into(po, milli(10), 3000);
  s.purchases.push({ id: id("c2000000"), supplier: "Distribuidora (exemplo)", purchased_at: at, total_cents: 8000, expense_id: id("c3000000"), status: "recorded",
    lines: [{ item_id: po.id, item_name: po.name, unit: po.unit, quantity: 10, total_cents: 3000 }, { item_id: sh.id, item_name: sh.name, unit: sh.unit, quantity: 1000, total_cents: 5000 }],
    version: 1 });
  s.bookings.push(
    { id: id("c4000000"), starts_at: iso(s.clock - 21 * 3_600_000), service_id: FX.services.corteA, customer_name: "Ana Beatriz (exemplo)", price: 6000 },
    { id: id("c4000000"), starts_at: iso(s.clock - 20 * 3_600_000), service_id: FX.services.barbaA, customer_name: "Carlos (exemplo)", price: 4000 },
  );
}
function state(): State {
  if (!shared) {
    shared = { items: [], usage: [], purchases: [], consumptions: [], bookings: [], idem: new Map(), seq: 0, clock: Date.parse(FIXED_NOW) };
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
/** Valida e trava (copia) os itens; só grava se tudo passar: tudo ou nada. */
function transaction<T>(run: () => T): T {
  const s = state();
  const snapshot = clone(s.items);
  try {
    return run();
  } catch (e) {
    s.items = snapshot;
    throw e;
  }
}
const validQty = (q: number) => q > 0 && q <= 999_999 && Math.abs(q * 1000 - Math.round(q * 1000)) < 1e-6;
const inWindow = (v: string, a: string, z: string) => Date.parse(v) >= Date.parse(a) && Date.parse(v) < Date.parse(z);

export function createDemoPort(): MaterialsPort {
  return {
    kind: "demo",
    async base(): Promise<MaterialsBase> {
      return { timezone: tenantA.timezone, services: clone(SERVICES), now: iso(state().clock) };
    },
    async list() {
      return { items: state().items.map(view).sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name)), usage: clone(state().usage) };
    },
    saveItem(input, key) {
      return once(key, () => {
        const s = state();
        const name = input.name.trim();
        if (!name || !["un", "ml", "g"].includes(input.unit)) fail("VALIDATION_ERROR", "item");
        if (s.items.some((i) => i.id !== input.item_id && i.active && i.name.toLowerCase() === name.toLowerCase())) fail("POLICY_REJECTED", "name");
        if (input.item_id) {
          const i = findItem(input.item_id) ?? fail("NOT_FOUND");
          if (i.version !== input.expected_version) fail("STALE_VERSION");
          if (i.unit !== input.unit && i.moved) fail("POLICY_REJECTED", "unit");
          Object.assign(i, { name, kind: input.kind ?? i.kind, unit: input.unit, active: input.active ?? i.active, min: input.min_qty ?? null, version: i.version + 1 });
          return view(i);
        }
        const i: Item = { id: id("c1000000"), name, kind: input.kind ?? "consumable", unit: input.unit, active: input.active ?? true, qty: 0, value: 0, min: input.min_qty ?? null, version: 1, moved: false };
        s.items.push(i);
        return view(i);
      });
    },
    saveUsage(serviceId, itemId, quantity, key) {
      return once(key, () => {
        const s = state();
        if (!SERVICES.some((x) => x.id === serviceId)) fail("NOT_FOUND", "service_id");
        if (!findItem(itemId)) fail("NOT_FOUND", "item_id");
        if (quantity !== null && !validQty(quantity)) fail("VALIDATION_ERROR", "quantity");
        s.usage = s.usage.filter((u) => !(u.service_id === serviceId && u.item_id === itemId));
        if (quantity !== null) s.usage.push({ service_id: serviceId, item_id: itemId, quantity });
        return clone(s.usage);
      });
    },
    purchase(supplier, purchasedAt, lines, recordExpense, key) {
      return once(key, () => transaction(() => {
        const s = state();
        if (!lines.length || new Set(lines.map((l) => l.item_id)).size !== lines.length || lines.some((l) => !validQty(l.quantity) || l.total_cents < 0)) fail("VALIDATION_ERROR", "lines");
        if (Date.parse(purchasedAt) > s.clock + 300_000) fail("VALIDATION_ERROR", "purchased_at");
        const items = lines.map((l) => findItem(l.item_id) ?? fail("NOT_FOUND", "item_id"));
        lines.forEach((l, n) => into(items[n]!, milli(l.quantity), l.total_cents));
        const total = lines.reduce((t, l) => t + l.total_cents, 0);
        const p: MaterialPurchase = { id: id("c2000000"), supplier: supplier?.trim() || null, purchased_at: purchasedAt, total_cents: total,
          expense_id: recordExpense && total > 0 ? id("c3000000") : null, status: "recorded",
          lines: lines.map((l, n) => ({ item_id: l.item_id, item_name: items[n]!.name, unit: items[n]!.unit, quantity: l.quantity, total_cents: l.total_cents })), version: 1 };
        s.purchases.push(p);
        return clone(p);
      }));
    },
    reversePurchase(input, key) {
      return once(key, () => transaction(() => {
        const p = state().purchases.find((x) => x.id === input.id) ?? fail("NOT_FOUND");
        if (p.version !== input.version) fail("STALE_VERSION");
        if (p.status !== "recorded") fail("POLICY_REJECTED", "status");
        for (const l of p.lines) out(findItem(l.item_id)!, milli(l.quantity));
        Object.assign(p, { status: "reversed", version: p.version + 1 });
        return clone(p);
      }));
    },
    adjust(item, counted, reason, key) {
      return once(key, () => {
        const i = findItem(item.id) ?? fail("NOT_FOUND");
        if (!(counted >= 0) || !reason.trim()) fail("VALIDATION_ERROR", reason.trim() ? "counted" : "reason");
        if (i.version !== item.version) fail("STALE_VERSION");
        const delta = milli(counted) - i.qty;
        if (delta === 0) fail("POLICY_REJECTED", "counted");
        if (delta < 0) out(i, -delta);
        else into(i, delta, i.qty > 0 ? Math.round((i.value * delta) / i.qty) : 0);
        return view(i);
      });
    },
    consume(bookingId, lines, key) {
      return once(key, () => transaction(() => {
        const s = state();
        const b = s.bookings.find((x) => x.id === bookingId) ?? fail("NOT_FOUND", "booking_id");
        const use = lines ?? s.usage.filter((u) => u.service_id === b.service_id && findItem(u.item_id)?.active).map((u) => ({ item_id: u.item_id, quantity: u.quantity }));
        if (!use.length) fail("POLICY_REJECTED", "usage");
        if (new Set(use.map((l) => l.item_id)).size !== use.length || use.some((l) => !validQty(l.quantity))) fail("VALIDATION_ERROR", "lines");
        const items = use.map((l) => findItem(l.item_id) ?? fail("NOT_FOUND", "item_id"));
        if (s.consumptions.some((c) => c.booking_id === bookingId && c.status === "active")) fail("POLICY_REJECTED", "consumed");
        const order = use.map((l, n) => ({ l, i: items[n]! })).sort((a, z) => a.i.id.localeCompare(z.i.id));
        const out_ = order.map(({ l, i }) => ({ item_id: i.id, item_name: i.name, unit: i.unit, quantity: l.quantity, cost_cents: out(i, milli(l.quantity)) }));
        const c: MaterialConsumption = { id: id("c5000000"), booking_id: bookingId, status: "active", cost_cents: out_.reduce((t, x) => t + x.cost_cents, 0),
          source: lines ? "manual" : "usage", lines: out_.sort((a, z) => a.item_name.localeCompare(z.item_name)), created_at: ts(), version: 2 };
        s.consumptions.push(c);
        return clone(c);
      }));
    },
    reverseConsumption(input, key) {
      return once(key, () => {
        const c = state().consumptions.find((x) => x.id === input.id) ?? fail("NOT_FOUND");
        if (c.version !== input.version) fail("STALE_VERSION");
        if (c.status !== "active") fail("POLICY_REJECTED", "reversed");
        for (const l of c.lines) into(findItem(l.item_id)!, milli(l.quantity), l.cost_cents);
        Object.assign(c, { status: "reversed", version: c.version + 1 });
        return clone(c);
      });
    },
    async purchases(period) {
      return clone(state().purchases.filter((p) => inWindow(p.purchased_at, period.starts_at, period.ends_at)).reverse());
    },
    async bookings(period): Promise<MaterialBooking[]> {
      const s = state();
      return s.bookings.filter((b) => inWindow(b.starts_at, period.starts_at, period.ends_at)).reverse().map((b) => ({
        booking_id: b.id, starts_at: b.starts_at, service_id: b.service_id, service_name: SERVICES.find((x) => x.id === b.service_id)!.name, customer_name: b.customer_name,
        agreed_price_cents: b.price, has_usage: s.usage.some((u) => u.service_id === b.service_id),
        consumption: clone(s.consumptions.find((c) => c.booking_id === b.id && c.status === "active") ?? null) }));
    },
    async margin(period): Promise<MarginReport> {
      const s = state();
      const rows = s.bookings.filter((b) => inWindow(b.starts_at, period.starts_at, period.ends_at))
        .map((b) => ({ b, cost: s.consumptions.find((c) => c.booking_id === b.id && c.status === "active")?.cost_cents ?? null }));
      const services = [...new Set(rows.map((r) => r.b.service_id))].map((sid) => {
        const mine = rows.filter((r) => r.b.service_id === sid);
        const covered = mine.filter((r) => r.cost !== null);
        const covRev = covered.reduce((t, r) => t + r.b.price, 0);
        const cost = covered.reduce((t, r) => t + r.cost!, 0);
        return { service_id: sid, service_name: SERVICES.find((x) => x.id === sid)!.name, completed: mine.length, with_materials: covered.length,
          revenue_cents: mine.reduce((t, r) => t + r.b.price, 0), covered_revenue_cents: covRev, material_cost_cents: cost, margin_cents: covRev - cost,
          margin_bps: covRev > 0 ? Math.round(((covRev - cost) * 10000) / covRev) : null };
      }).sort((a, z) => a.service_name.localeCompare(z.service_name));
      const sum = (k: "completed" | "with_materials" | "revenue_cents" | "covered_revenue_cents" | "material_cost_cents" | "margin_cents") => services.reduce((t, x) => t + x[k], 0);
      return { services, totals: { completed: sum("completed"), with_materials: sum("with_materials"), revenue_cents: sum("revenue_cents"),
        covered_revenue_cents: sum("covered_revenue_cents"), material_cost_cents: sum("material_cost_cents"), margin_cents: sum("margin_cents") } };
    },
  };
}
