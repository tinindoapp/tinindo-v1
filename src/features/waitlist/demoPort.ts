// EMULAÇÃO da lista de espera para a demonstração sem servidor. Mesmas regras do banco que a tela explica:
// uma pessoa de cada vez por horário, hold com prazo, token de uso único, aceite repetido devolve a mesma
// reserva, compartilhamento manual nunca vira "entregue". Nada sai do navegador.
import { DEFAULT_MESSAGES, ERROR_STATUS, type ErrorCode, RETRYABLE } from "@contracts";
import { FIXED_NOW, FX, services as fixtureServices, tenantA } from "@contracts/fixtures.ts";
import { ApiError } from "../../lib/api/client.ts";
import type { Booking, TimeRange, WaitlistEntry, WaitlistOffer } from "./types.ts";
import type { OfferLinkPort, WaitlistPort } from "./port.ts";

function fail(code: ErrorCode, field?: string): never {
  throw new ApiError(code, DEFAULT_MESSAGES[code], ERROR_STATUS[code], crypto.randomUUID(), RETRYABLE.has(code), field);
}

const CUSTOMERS = [
  { id: FX.customers.abInA, name: "Cliente Exemplo Ana" },
  { id: FX.customers.guestInA, name: "Cliente Exemplo Bruno" },
];
const HOLD_MIN = 15;

interface State {
  entries: WaitlistEntry[];
  candidates: { id: string; entry_id: string; slot: TimeRange; status: "open" | "offered" | "stale" }[];
  offers: (WaitlistOffer & { tokenValue: string; slot: TimeRange; booking?: Booking })[];
  idem: Map<string, unknown>;
  seq: number;
}

let shared: State | null = null;
function state(): State {
  if (shared) return shared;
  const now = Date.parse(FIXED_NOW);
  const entry: WaitlistEntry = {
    id: "71000000-0000-4000-8000-000000000001", tenant_id: FX.tenants.A, customer_id: FX.customers.abInA, service_id: FX.services.corteA,
    status: "active", joined_at: "2026-10-18T13:00:00Z", valid_until: new Date(now + 30 * 86_400_000).toISOString(),
    acceptable_windows: [{ weekday: 3, local_start: "09:00", local_end: "19:00" }], version: 1,
  };
  shared = {
    entries: [entry],
    // Vaga liberada por um cancelamento na quarta 21/10 às 10:00 (atendimento cancelado da agenda de exemplo).
    candidates: [{ id: "72000000-0000-4000-8000-000000000001", entry_id: entry.id, status: "open",
      slot: { starts_at: "2026-10-21T13:00:00Z", ends_at: "2026-10-21T13:30:00Z" } }],
    offers: [],
    idem: new Map(),
    seq: 0,
  };
  return shared;
}

/** Só para testes. */
export function resetDemoState() {
  shared = null;
}

const once = <T>(key: string, run: () => T): T => {
  const s = state();
  if (s.idem.has(key)) return structuredClone(s.idem.get(key)) as T;
  const v = run();
  s.idem.set(key, structuredClone(v));
  return v;
};
const id = (prefix: string) => `${prefix}-0000-4000-8000-${String(++state().seq + 100).padStart(12, "0")}`;
const clone = <T>(v: T) => Promise.resolve(structuredClone(v));
const now = () => Date.parse(FIXED_NOW);
const tokenFor = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
};
const overlaps = (a: TimeRange, b: TimeRange) => Date.parse(a.starts_at) < Date.parse(b.ends_at) && Date.parse(b.starts_at) < Date.parse(a.ends_at);

function close(o: State["offers"][number], status: WaitlistOffer["status"]) {
  const s = state();
  o.status = status;
  o.version = (o.version ?? 1) + 1;
  const c = s.candidates.find((x) => x.entry_id === o.entry_id && x.slot.starts_at === o.slot.starts_at);
  if (c) c.status = "stale";
  const e = s.entries.find((x) => x.id === o.entry_id);
  if (e && e.status === "offered") e.status = "active";
}

export function createDemoPort(): WaitlistPort {
  return {
    kind: "demo",
    now: () => new Date(FIXED_NOW),
    base: () => clone({ timezone: tenantA.timezone, customers: CUSTOMERS,
      services: fixtureServices.filter((x) => x.tenant_id === FX.tenants.A && x.active).map((x) => ({ id: x.id, name: x.name, duration_min: x.duration_min })) }),
    list() {
      const s = state();
      for (const o of s.offers) if (o.status === "offered" && Date.parse(o.expires_at) <= now()) close(o, "expired");
      const open = (e: WaitlistEntry) => e.status === "active" || e.status === "offered";
      return clone({
        entries: s.entries.filter(open),
        candidates: s.candidates.filter((c) => c.status === "open" && s.entries.some((e) => e.id === c.entry_id && e.status === "active")),
        offers: s.offers.map(({ tokenValue: _t, slot: _s, booking: _b, ...o }) => o).reverse(),
      });
    },
    async join(input, key) {
      return clone(once(`join:${key}`, () => {
        const s = state();
        if (s.entries.some((e) => e.customer_id === input.customer_id && e.service_id === input.service_id && (e.status === "active" || e.status === "offered"))) {
          fail("POLICY_REJECTED", "customer_id");
        }
        const e: WaitlistEntry = { id: id("71000000"), tenant_id: FX.tenants.A, customer_id: input.customer_id, service_id: input.service_id,
          status: "active", joined_at: new Date(now()).toISOString(), valid_until: input.valid_until, acceptable_windows: input.windows, version: 1 };
        s.entries.push(e);
        return e;
      }));
    },
    async withdraw(entry, key) {
      once(`withdraw:${key}`, () => {
        const s = state();
        const e = s.entries.find((x) => x.id === entry.id) ?? fail("NOT_FOUND");
        for (const o of s.offers) if (o.entry_id === e.id && o.status === "offered") close(o, "invalidated");
        e.status = "withdrawn";
        return true;
      });
    },
    async prepareOffer(entry, slot, key) {
      return clone(once(`prepare:${key}`, () => {
        const s = state();
        const e = s.entries.find((x) => x.id === entry.id) ?? fail("NOT_FOUND", "entry_id");
        if (e.status !== "active") fail("POLICY_REJECTED", "entry_id");
        if (s.offers.some((o) => (o.status === "offered" || o.status === "accepted") && overlaps(o.slot, slot))) fail("SLOT_CONFLICT");
        const tokenValue = tokenFor();
        const o = { id: id("73000000"), entry_id: e.id, booking_hold_id: id("60000000"), quote_id: id("74000000"), status: "offered" as const,
          expires_at: new Date(now() + HOLD_MIN * 60_000).toISOString(), delivery_state: "prepared" as const, version: 1, tokenValue, slot };
        s.offers.push(o);
        e.status = "offered";
        const c = s.candidates.find((x) => x.entry_id === e.id && x.slot.starts_at === slot.starts_at);
        if (c) c.status = "offered";
        const { tokenValue: _t, slot: _s, ...out } = o;
        return { ...out, token: tokenValue };
      }));
    },
    async markShared(offerId) {
      const o = state().offers.find((x) => x.id === offerId) ?? fail("NOT_FOUND");
      o.delivery_state = "share_opened";
    },
    async cancelOffer(offerId, key) {
      once(`cancel:${key}`, () => {
        const o = state().offers.find((x) => x.id === offerId) ?? fail("NOT_FOUND");
        if (o.status !== "offered") fail("POLICY_REJECTED", "status");
        close(o, "invalidated");
        return true;
      });
    },
  };
}

export function createDemoLinkPort(): OfferLinkPort {
  const find = (token: string) => state().offers.find((o) => o.tokenValue === token) ?? fail("NOT_FOUND");
  return {
    kind: "demo",
    async view(token) {
      const o = find(token);
      const e = state().entries.find((x) => x.id === o.entry_id)!;
      const svc = fixtureServices.find((x) => x.id === e.service_id)!;
      const status = o.status === "offered" && Date.parse(o.expires_at) <= now() ? "expired" : o.status;
      return clone({ business_name: tenantA.name, service_name: svc.name, slot: o.slot, timezone: tenantA.timezone,
        price_cents: svc.base_price_cents, status, expires_at: o.expires_at });
    },
    async accept(token) {
      const o = find(token);
      if (o.status === "accepted" && o.booking) return clone(o.booking);
      if (o.status !== "offered" || Date.parse(o.expires_at) <= now()) fail("POLICY_REJECTED", "expires_at");
      const e = state().entries.find((x) => x.id === o.entry_id)!;
      const svc = fixtureServices.find((x) => x.id === e.service_id)!;
      o.booking = { id: o.booking_hold_id, tenant_id: FX.tenants.A, resource_id: FX.resources.A, customer_id: e.customer_id,
        service_id: e.service_id, starts_at: o.slot.starts_at, ends_at: o.slot.ends_at, status: "confirmed", hold_expires_at: null,
        price_quote_id: o.quote_id, agreed_price_cents: svc.base_price_cents, source: "waitlist", version: 2 };
      o.status = "accepted";
      e.status = "fulfilled";
      return clone(o.booking);
    },
    async decline(token) {
      const o = find(token);
      if (o.status === "declined") return;
      if (o.status !== "offered") fail("POLICY_REJECTED", "status");
      close(o, "declined");
    },
  };
}
