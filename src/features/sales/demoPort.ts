// EMULAÇÃO dos orçamentos para a demonstração sem servidor. Mesmas regras do banco que a tela explica:
// versão imutável com hash, total calculado aqui (nunca o enviado), link com token de uso do cliente, aceite que
// cita versão + hash dentro da validade, horário revalidado no aceite, aceite repetido devolve a mesma decisão.
// Nada sai do navegador. Aceitar não cria cobrança nem recebimento.
import { type Booking, DEFAULT_MESSAGES, ERROR_STATUS, type ErrorCode, RETRYABLE, type SalesQuote, type SalesQuoteVersion } from "@contracts";
import { FIXED_NOW, FX, services as fixtureServices, tenantA } from "@contracts/fixtures.ts";
import { ApiError } from "../../lib/api/client.ts";
import type { QuoteDecision, QuoteDraft, QuoteLinkPort, QuoteView, SalesPort } from "./port.ts";
import { effectiveStatus, lineTotal, quoteTotal } from "./rules.ts";

function fail(code: ErrorCode, field?: string): never {
  throw new ApiError(code, DEFAULT_MESSAGES[code], ERROR_STATUS[code], crypto.randomUUID(), RETRYABLE.has(code), field);
}

const CUSTOMERS = [
  { id: FX.customers.abInA, name: "Cliente Exemplo Ana" },
  { id: FX.customers.guestInA, name: "Cliente Exemplo Bruno" },
];
const SERVICES = fixtureServices.filter((s) => s.tenant_id === FX.tenants.A);
const now = () => new Date(FIXED_NOW);
/**
 * Custo de materiais por atendimento na demonstração, igual ao exemplo da tela Materiais (P30): o corte usa 20 ml de
 * shampoo (R$ 0,05/ml) e uma pomada (R$ 3,00). A barba não tem ficha. Os módulos não se importam; o servidor calcula de verdade.
 */
const DEMO_MATERIAL_CENTS: Record<string, number> = { [FX.services.corteA]: 400 };
const clone = <T>(v: T): T => structuredClone(v);

interface Row {
  quote: Omit<SalesQuote, "current" | "status" | "link_active"> & { status: "draft" | "sent" | "accepted" | "declined" | "cancelled" };
  versions: SalesQuoteVersion[];
  token: string | null;
  decision: { decision: "accepted" | "declined"; version_no: number; snapshot_hash: string; booking: Booking | null; decided_at: string } | null;
}
interface State { rows: Row[]; idem: Map<string, unknown>; seq: number }

let shared: State | null = null;
function state(): State {
  shared ??= { rows: [], idem: new Map(), seq: 0 };
  return shared;
}
/** Só para testes. */
export function resetDemoState() {
  shared = null;
}

const once = async <T>(key: string, run: () => Promise<T>): Promise<T> => {
  const s = state();
  if (s.idem.has(key)) return clone(s.idem.get(key)) as T;
  const v = await run();
  s.idem.set(key, clone(v));
  return v;
};
const id = (prefix: string) => `${prefix}-0000-4000-8000-${String(++state().seq).padStart(12, "0")}`;

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function token(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function buildVersion(quoteId: string, versionNo: number, d: QuoteDraft): Promise<SalesQuoteVersion> {
  const t = now().getTime();
  if (!d.title.trim() || d.title.trim().length > 120) fail("VALIDATION_ERROR", "title");
  if (!(Date.parse(d.valid_until) > t) || Date.parse(d.valid_until) > t + 90 * 86_400_000) fail("VALIDATION_ERROR", "valid_until");
  if (d.items.length < 1 || d.items.length > 20) fail("VALIDATION_ERROR", "items");
  const items = d.items.map((i) => {
    if (!i.description.trim() || i.quantity < 1 || i.quantity > 99 || i.unit_price_cents < 0) fail("VALIDATION_ERROR", "items");
    if (i.service_id && !SERVICES.some((s) => s.id === i.service_id)) fail("NOT_FOUND", "service_id");
    return { service_id: i.service_id, description: i.description.trim(), quantity: i.quantity, unit_price_cents: i.unit_price_cents,
      line_total_cents: lineTotal(i) };
  });
  let slot: SalesQuoteVersion["slot"] = null;
  if (d.slot) {
    const svc = SERVICES.find((s) => s.id === d.slot!.service_id);
    if (!svc || !items.some((i) => i.service_id === svc.id) || Date.parse(d.slot.starts_at) <= t) fail("VALIDATION_ERROR", "slot");
    slot = { service_id: svc.id, starts_at: d.slot.starts_at, ends_at: new Date(Date.parse(d.slot.starts_at) + svc.duration_min * 60_000).toISOString() };
  }
  const snapshot = { quote_id: quoteId, version_no: versionNo, title: d.title.trim(), items, total_cents: quoteTotal(items), currency: "BRL",
    valid_until: d.valid_until, slot, notes: d.notes?.trim() || null };
  return { ...snapshot, currency: "BRL", snapshot_hash: await sha256(JSON.stringify(snapshot)), created_at: now().toISOString() };
}

function toQuote(r: Row): SalesQuote {
  const current = r.versions[r.versions.length - 1]!;
  const status = effectiveStatus(r.quote.status, current.valid_until, now());
  return clone({ ...r.quote, status, link_active: status === "sent" && r.token !== null, current });
}
const find = (quoteId: string) => state().rows.find((r) => r.quote.id === quoteId) ?? fail("NOT_FOUND");

export function createDemoPort(): SalesPort {
  return {
    kind: "demo",
    now,
    async base() {
      return { timezone: tenantA.timezone, customers: clone(CUSTOMERS),
        services: SERVICES.map((s) => ({ id: s.id, name: s.name, duration_min: s.duration_min, base_price_cents: s.base_price_cents })) };
    },
    async list() {
      return state().rows.map(toQuote).reverse();
    },
    async get(quoteId) {
      const r = find(quoteId);
      return { quote: toQuote(r), versions: clone([...r.versions].reverse()),
        decision: r.decision ? { decision: r.decision.decision, version_no: r.decision.version_no, snapshot_hash: r.decision.snapshot_hash,
          booking_id: r.decision.booking?.id ?? null, decided_at: r.decision.decided_at } : null };
    },
    create(d, key) {
      return once(key, async () => {
        if (!CUSTOMERS.some((c) => c.id === d.customer_id)) fail("NOT_FOUND", "customer_id");
        const quoteId = id("81000000");
        const v = await buildVersion(quoteId, 1, d);
        const row: Row = { quote: { id: quoteId, customer_id: d.customer_id, status: "draft", current_version: 1, sent_at: null,
          decided_at: null, decided_version: null, booking_id: null, version: 1, created_at: now().toISOString() }, versions: [v], token: null, decision: null };
        state().rows.push(row);
        return toQuote(row);
      });
    },
    revise(q, d, key) {
      return once(key, async () => {
        const r = find(q.id);
        if (r.quote.current_version !== q.current_version) fail("STALE_VERSION");
        if (r.quote.status !== "draft" && r.quote.status !== "sent") fail("POLICY_REJECTED", "status");
        r.versions.push(await buildVersion(r.quote.id, r.quote.current_version + 1, d));
        r.quote.current_version += 1;
        r.quote.version += 1;
        return toQuote(r);
      });
    },
    send(q, key) {
      const s = state();
      if (s.idem.has(key)) return Promise.resolve({ ...(clone(s.idem.get(key)) as { quote: SalesQuote }), token: null });
      const r = find(q.id);
      if (r.quote.current_version !== q.current_version) fail("STALE_VERSION");
      if (r.quote.status !== "draft" && r.quote.status !== "sent") fail("POLICY_REJECTED", "status");
      if (Date.parse(r.versions[r.versions.length - 1]!.valid_until) <= now().getTime()) fail("POLICY_REJECTED", "valid_until");
      r.token = token();
      r.quote.status = "sent";
      r.quote.sent_at = now().toISOString();
      r.quote.version += 1;
      const quote = toQuote(r);
      s.idem.set(key, { quote });
      return Promise.resolve({ quote, token: r.token });
    },
    cancel(quoteId, key) {
      return once(key, async () => {
        const r = find(quoteId);
        if (r.quote.status !== "draft" && r.quote.status !== "sent") fail("POLICY_REJECTED", "status");
        r.quote.status = "cancelled";
        r.token = null;
        r.quote.version += 1;
        return toQuote(r);
      });
    },
    async materialCost(quoteId) {
      const r = find(quoteId);
      const v = r.versions.find((x) => x.version_no === r.quote.current_version)!;
      const lines = v.items.map((i, line) => {
        const unit = i.service_id ? DEMO_MATERIAL_CENTS[i.service_id] : undefined;
        return { line, service_id: i.service_id, description: i.description, quantity: i.quantity, line_total_cents: i.line_total_cents,
          material_cost_cents: (unit ?? 0) * i.quantity, covered: unit !== undefined };
      });
      const cost = lines.reduce((t, l) => t + l.material_cost_cents, 0);
      return { quote_id: quoteId, version_no: v.version_no, total_cents: v.total_cents, lines, material_cost_cents: cost,
        margin_cents: v.total_cents - cost, covered: lines.every((l) => l.covered) };
    },
  };
}

/** Horário ocupado por outro aceite da demonstração (a agenda real fica no servidor). */
const slotTaken = (slot: { starts_at: string; ends_at: string }) => state().rows.some((r) =>
  r.decision?.booking && Date.parse(r.decision.booking.starts_at) < Date.parse(slot.ends_at)
  && Date.parse(slot.starts_at) < Date.parse(r.decision.booking.ends_at));

export function createDemoLinkPort(): QuoteLinkPort {
  const byToken = (t: string) => {
    const r = state().rows.find((x) => x.token === t);
    return r && r.quote.status !== "cancelled" ? r : fail("NOT_FOUND");
  };
  const result = (r: Row): QuoteDecision => clone({ status: r.decision!.decision, version_no: r.decision!.version_no,
    decided_at: r.decision!.decided_at, booking: r.decision!.booking });
  const check = (r: Row, v: QuoteView) => {
    const cur = r.versions[r.versions.length - 1]!;
    if (cur.version_no !== v.version_no || cur.snapshot_hash !== v.snapshot_hash) fail("STALE_VERSION");
    return cur;
  };
  return {
    kind: "demo",
    async view(t) {
      const r = byToken(t);
      const v = r.versions.find((x) => x.version_no === (r.quote.decided_version ?? r.quote.current_version))!;
      const svc = v.slot ? SERVICES.find((s) => s.id === v.slot!.service_id) : null;
      return clone({ ...v, business_name: tenantA.name, timezone: tenantA.timezone,
        status: effectiveStatus(r.quote.status, v.valid_until, now()), slot_service_name: svc?.name ?? null });
    },
    async accept(t, view) {
      const r = byToken(t);
      if (r.quote.status === "accepted") {
        if (r.decision!.version_no !== view.version_no || r.decision!.snapshot_hash !== view.snapshot_hash) fail("STALE_VERSION");
        return result(r);
      }
      if (r.quote.status !== "sent") fail("POLICY_REJECTED", "status");
      const cur = check(r, view);
      if (Date.parse(cur.valid_until) <= now().getTime()) fail("POLICY_REJECTED", "valid_until");
      let booking: Booking | null = null;
      if (cur.slot) {
        if (slotTaken(cur.slot)) fail("SLOT_CONFLICT");
        booking = { id: id("82000000"), tenant_id: FX.tenants.A, resource_id: FX.resources.A, customer_id: r.quote.customer_id,
          service_id: cur.slot.service_id, starts_at: cur.slot.starts_at, ends_at: cur.slot.ends_at, status: "confirmed", status_reason: null,
          hold_expires_at: null, price_quote_id: null, agreed_price_cents: cur.total_cents, source: "quote", version: 2 };
      }
      r.decision = { decision: "accepted", version_no: cur.version_no, snapshot_hash: cur.snapshot_hash, booking, decided_at: now().toISOString() };
      Object.assign(r.quote, { status: "accepted", decided_at: r.decision.decided_at, decided_version: cur.version_no,
        booking_id: booking?.id ?? null, version: r.quote.version + 1 });
      return result(r);
    },
    async decline(t, view) {
      const r = byToken(t);
      if (r.quote.status === "declined") return result(r);
      if (r.quote.status !== "sent") fail("POLICY_REJECTED", "status");
      const cur = check(r, view);
      r.decision = { decision: "declined", version_no: cur.version_no, snapshot_hash: cur.snapshot_hash, booking: null, decided_at: now().toISOString() };
      Object.assign(r.quote, { status: "declined", decided_at: r.decision.decided_at, decided_version: cur.version_no, version: r.quote.version + 1 });
      return result(r);
    },
  };
}
