// EMULAÇÃO da Equipe para a demonstração sem servidor. Mesmas regras do banco que a tela explica: reserva composta tudo
// ou nada (o conflito de um recurso recusa a reserva inteira e diz qual); profissional vinculado respeita a agenda
// individual; turmas com lotação; comissão congelada na reserva, lançada uma vez na conclusão e estornada uma vez.
import {
  DEFAULT_MESSAGES,
  ERROR_STATUS,
  type ErrorCode,
  RETRYABLE,
  type TeamBooking,
  type TeamClass,
  type TeamCommissionEntry,
  type TeamCommissionRule,
  type TeamResource,
  type TimeRange,
} from "@contracts";
import { FIXED_NOW, FX, services as fixtureServices, tenantA } from "@contracts/fixtures.ts";
import { ApiError } from "../../lib/api/client.ts";
import type { ResourcesPort, TeamBase } from "./port.ts";

function fail(code: ErrorCode, field?: string): never {
  throw new ApiError(code, DEFAULT_MESSAGES[code], ERROR_STATUS[code], crypto.randomUUID(), RETRYABLE.has(code), field);
}
const clone = <T>(v: T): T => structuredClone(v);
const MIN = 60_000;
const DAY = 86_400_000;
/** Horário de funcionamento da demonstração: 08:00–20:00 locais (São Paulo, sem horário de verão). */
const OPEN_H = 8;
const CLOSE_H = 20;
export const DEMO_CUSTOMERS = [
  { id: FX.customers.abInA, name: "Ana Beatriz (exemplo)" },
  { id: FX.customers.guestInA, name: "Carlos (exemplo)" },
];
const SERVICES = fixtureServices.filter((s) => s.tenant_id === FX.tenants.A);
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
/** Meia-noite local (UTC−3) do dia de `ms`, em ms UTC. */
const dayStart = (ms: number) => Math.floor((ms - 3 * 3_600_000) / DAY) * DAY + 3 * 3_600_000;

interface Booking extends TeamBooking { occ: [number, number] }
interface Klass extends TeamClass { occ: [number, number] }
interface State {
  resources: TeamResource[];
  rules: TeamCommissionRule[];
  bookings: Booking[];
  classes: Klass[];
  entries: TeamCommissionEntry[];
  /** Ocupação da agenda individual do dono (P03), para o profissional vinculado. */
  agendaBusy: [number, number][];
  idem: Map<string, unknown>;
  seq: number;
  clock: number;
}
let shared: State | null = null;
const id = (p: string) => `${p}-0000-4000-8000-${String(++shared!.seq).padStart(12, "0")}`;
const ts = () => iso((shared!.clock += 1000));

function seed(s: State) {
  const add = (kind: TeamResource["kind"], name: string, commission_bps: number | null = null, agenda_linked = false) => {
    const r: TeamResource = { id: id("b1000000"), kind, name, active: true, commission_bps, agenda_linked, version: 1 };
    s.resources.push(r);
    return r;
  };
  const bia = add("professional", "Bia", 4000);
  add("professional", "Caio (você)", null, true);
  add("room", "Sala de coloração");
  const c1 = add("chair", "Cadeira 1");
  add("chair", "Cadeira 2");
  s.rules.push({ professional_id: bia.id, service_id: FX.services.corteA, bps: 5000 });
  // Ontem 15:00 local: atendimento de Bia na Cadeira 1, pronto para concluir.
  const y = dayStart(s.clock) - DAY + 15 * 3_600_000;
  const corte = SERVICES.find((x) => x.id === FX.services.corteA)!;
  s.bookings.push({ id: id("b2000000"), service_id: corte.id, service_name: corte.name, customer_id: DEMO_CUSTOMERS[0]!.id, customer_name: DEMO_CUSTOMERS[0]!.name,
    professional_id: bia.id, professional_name: bia.name, resources: [{ id: bia.id, kind: "professional", name: bia.name }, { id: c1.id, kind: "chair", name: c1.name }],
    starts_at: iso(y), ends_at: iso(y + 30 * MIN), status: "confirmed", agreed_price_cents: corte.base_price_cents, commission_bps: 5000, commission_cents: 0,
    receivable_id: null, version: 1, occ: [y, y + 40 * MIN] });
  // Amanhã 11:00 local: atendimento na agenda individual do dono.
  const t = dayStart(s.clock) + DAY + 11 * 3_600_000;
  s.agendaBusy.push([t, t + 40 * MIN]);
}
function state(): State {
  if (!shared) {
    shared = { resources: [], rules: [], bookings: [], classes: [], entries: [], agendaBusy: [], idem: new Map(), seq: 0, clock: Date.parse(FIXED_NOW) };
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
const overlaps = (a: [number, number], b: [number, number]) => a[0] < b[1] && b[0] < a[1];
const strip = <T extends { occ: unknown }>(x: T): Omit<T, "occ"> => { const { occ: _occ, ...rest } = x; return clone(rest); };
const findRes = (rid: string) => state().resources.find((r) => r.id === rid);
const service = (sid: string) => SERVICES.find((x) => x.id === sid && x.active) ?? fail("NOT_FOUND", "service_id");
const bpsFor = (profId: string, serviceId: string) =>
  state().rules.find((r) => r.professional_id === profId && r.service_id === serviceId)?.bps ?? findRes(profId)?.commission_bps ?? 0;
const commission = (base: number, bps: number) => Math.floor((base * bps + 5000) / 10000);
const net = (pred: (e: TeamCommissionEntry) => boolean) => state().entries.filter(pred).reduce((a, e) => a + e.amount_cents, 0);

/** Usos ativos de um recurso (reservas e turmas). */
function usesOf(rid: string): [number, number][] {
  const s = state();
  return [
    ...s.bookings.filter((b) => b.status !== "cancelled" && b.resources.some((r) => r.id === rid)).map((b) => b.occ),
    ...s.classes.filter((c) => c.status !== "cancelled" && (c.professional_id === rid || c.room_id === rid)).map((c) => c.occ),
  ];
}
/** Mesmas conferências do banco, na mesma ordem: entrada, recursos, passado, horário, agenda individual, cada recurso. */
function checkAllocation(profId: string, others: string[], startMs: number, occ: [number, number], durMin: number) {
  const ids = [profId, ...others];
  if (ids.length > 5 || new Set(ids).size !== ids.length) fail("VALIDATION_ERROR", "resource_ids");
  const res = ids.map((x) => findRes(x) ?? fail("NOT_FOUND", "resource_ids"));
  if (res.some((r) => !r.active)) fail("POLICY_REJECTED", "resource_ids");
  if (res[0]!.kind !== "professional") fail("VALIDATION_ERROR", "professional_id");
  if (res.slice(1).some((r) => r.kind === "professional")) fail("VALIDATION_ERROR", "resource_ids");
  if (startMs < state().clock) fail("VALIDATION_ERROR", "starts_at");
  const d = dayStart(startMs);
  if (startMs < d + OPEN_H * 3_600_000 || startMs + durMin * MIN > d + CLOSE_H * 3_600_000) fail("SLOT_CONFLICT", "hours");
  if (res[0]!.agenda_linked && state().agendaBusy.some((b) => overlaps(b, occ))) fail("SLOT_CONFLICT", "agenda");
  for (const r of [...res].sort((a, b) => a.id.localeCompare(b.id))) if (usesOf(r.id).some((u) => overlaps(u, occ))) fail("SLOT_CONFLICT", r.kind);
  return res;
}
const occFor = (serviceId: string, startMs: number): [number, number] => {
  const svc = service(serviceId);
  return [startMs - svc.buffer_before_min * MIN, startMs + (svc.duration_min + svc.buffer_after_min) * MIN];
};
const classView = (c: Klass): TeamClass => ({ ...strip(c), booked: c.seats.filter((x) => x.status !== "cancelled").length, commission_cents: net((e) => e.class_id === c.id) });
const bookingView = (b: Booking): TeamBooking => ({ ...strip(b), commission_cents: net((e) => e.booking_id === b.id) });
const findBooking = (bid: string) => state().bookings.find((b) => b.id === bid) ?? fail("NOT_FOUND");
const findClass = (cid: string) => state().classes.find((c) => c.id === cid) ?? fail("NOT_FOUND");

export function createDemoPort(): ResourcesPort {
  return {
    kind: "demo",
    async base(): Promise<TeamBase> {
      return { timezone: tenantA.timezone, customers: clone(DEMO_CUSTOMERS), services: clone(SERVICES.filter((x) => x.active)), now: iso(state().clock) };
    },
    async list() {
      return { resources: clone(state().resources), commission_rules: clone(state().rules) };
    },
    save(input, key) {
      return once(key, () => {
        const s = state();
        const name = input.name.trim();
        if (input.kind !== "professional" && ((input.commission_bps ?? null) !== null || input.agenda_linked)) fail("VALIDATION_ERROR", "commission_bps");
        const dup = s.resources.some((r) => r.id !== input.resource_id && r.active && r.kind === input.kind && r.name.toLowerCase() === name.toLowerCase());
        const linkTaken = input.agenda_linked && s.resources.some((r) => r.id !== input.resource_id && r.agenda_linked);
        if (dup || linkTaken) fail("POLICY_REJECTED", "name");
        if (input.resource_id) {
          const r = findRes(input.resource_id) ?? fail("NOT_FOUND");
          if (r.version !== input.expected_version) fail("STALE_VERSION");
          if (r.kind !== input.kind) fail("VALIDATION_ERROR", "kind");
          if (r.active && input.active === false && usesOf(r.id).some((u) => u[1] > s.clock)) fail("POLICY_REJECTED", "active");
          Object.assign(r, { name, active: input.active ?? r.active, commission_bps: input.commission_bps ?? null, agenda_linked: input.agenda_linked ?? false, version: r.version + 1 });
          return clone(r);
        }
        const r: TeamResource = { id: id("b1000000"), kind: input.kind, name, active: input.active ?? true, commission_bps: input.commission_bps ?? null,
          agenda_linked: input.agenda_linked ?? false, version: 1 };
        s.resources.push(r);
        return clone(r);
      });
    },
    saveRule(professionalId, serviceId, bps, key) {
      return once(key, () => {
        const s = state();
        if (findRes(professionalId)?.kind !== "professional") fail("NOT_FOUND", "professional_id");
        service(serviceId);
        s.rules = s.rules.filter((r) => !(r.professional_id === professionalId && r.service_id === serviceId));
        if (bps !== null) s.rules.push({ professional_id: professionalId, service_id: serviceId, bps });
        return clone(s.rules);
      });
    },
    async availability(serviceId, professionalId, resourceIds, window) {
      const svc = service(serviceId);
      const out: TimeRange[] = [];
      for (let t = Date.parse(window.starts_at); t + svc.duration_min * MIN <= Date.parse(window.ends_at) && out.length < 500; t += 15 * MIN) {
        try {
          checkAllocation(professionalId, resourceIds, t, occFor(serviceId, t), svc.duration_min);
          out.push({ starts_at: iso(t), ends_at: iso(t + svc.duration_min * MIN) });
        } catch (e) {
          const code = (e as ApiError).code;
          if (code !== "SLOT_CONFLICT" && !((e as ApiError).field === "starts_at")) throw e;
        }
      }
      return out;
    },
    book(input, key) {
      return once(key, () => {
        const s = state();
        const svc = service(input.service_id);
        if (input.customer_id && !DEMO_CUSTOMERS.some((c) => c.id === input.customer_id)) fail("NOT_FOUND", "customer_id");
        const start = Date.parse(input.starts_at);
        const occ = occFor(svc.id, start);
        const res = checkAllocation(input.professional_id, input.resource_ids ?? [], start, occ, svc.duration_min);
        const b: Booking = { id: id("b2000000"), service_id: svc.id, service_name: svc.name, customer_id: input.customer_id ?? null,
          customer_name: DEMO_CUSTOMERS.find((c) => c.id === input.customer_id)?.name ?? null, professional_id: res[0]!.id, professional_name: res[0]!.name,
          resources: res.map((r) => ({ id: r.id, kind: r.kind, name: r.name })), starts_at: iso(start), ends_at: iso(start + svc.duration_min * MIN), status: "confirmed",
          agreed_price_cents: svc.base_price_cents, commission_bps: bpsFor(res[0]!.id, svc.id), commission_cents: 0, receivable_id: null, version: 1, occ };
        s.bookings.push(b);
        return bookingView(b);
      });
    },
    cancelBooking(input, _reason, key) {
      return once(key, () => {
        const b = findBooking(input.id);
        if (b.version !== input.version) fail("STALE_VERSION");
        if (b.status !== "confirmed") fail("POLICY_REJECTED", "status");
        Object.assign(b, { status: "cancelled", version: b.version + 1 });
        return bookingView(b);
      });
    },
    completeBooking(input, key) {
      return once(key, () => {
        const b = findBooking(input.id);
        if (b.version !== input.version) fail("STALE_VERSION");
        if (b.status !== "confirmed") fail("POLICY_REJECTED", "status");
        if (Date.parse(b.starts_at) > state().clock) fail("POLICY_REJECTED", "starts_at");
        Object.assign(b, { status: "completed", receivable_id: b.agreed_price_cents > 0 ? id("b3000000") : null, version: b.version + 1 });
        state().entries.push({ id: id("b4000000"), professional_id: b.professional_id, professional_name: b.professional_name, booking_id: b.id, class_id: null, kind: "accrual",
          base_cents: b.agreed_price_cents, bps: b.commission_bps, amount_cents: commission(b.agreed_price_cents, b.commission_bps), reversal_of: null, reversed: false, created_at: ts() });
        return bookingView(b);
      });
    },
    async schedule(window) {
      const s = state();
      const [a, z] = [Date.parse(window.starts_at), Date.parse(window.ends_at)];
      const inWin = (x: { starts_at: string; ends_at: string }) => Date.parse(x.starts_at) < z && Date.parse(x.ends_at) > a;
      const byStart = (x: { starts_at: string }, y: { starts_at: string }) => x.starts_at.localeCompare(y.starts_at);
      return { bookings: s.bookings.filter(inWin).sort(byStart).map(bookingView), classes: s.classes.filter(inWin).sort(byStart).map(classView) };
    },
    createClass(input, key) {
      return once(key, () => {
        const s = state();
        const svc = service(input.service_id);
        if (input.room_id && findRes(input.room_id)?.kind !== "room") fail("NOT_FOUND", "room_id");
        if (!(input.capacity >= 1 && input.capacity <= 200) || !input.title.trim()) fail("VALIDATION_ERROR", "class");
        const start = Date.parse(input.starts_at);
        const occ = occFor(svc.id, start);
        const res = checkAllocation(input.professional_id, input.room_id ? [input.room_id] : [], start, occ, svc.duration_min);
        const c: Klass = { id: id("b5000000"), title: input.title.trim(), service_id: svc.id, service_name: svc.name, professional_id: res[0]!.id, professional_name: res[0]!.name,
          room_id: input.room_id ?? null, room_name: input.room_id ? findRes(input.room_id)!.name : null, starts_at: iso(start), ends_at: iso(start + svc.duration_min * MIN),
          capacity: input.capacity, booked: 0, seat_price_cents: input.seat_price_cents ?? svc.base_price_cents, commission_bps: bpsFor(res[0]!.id, svc.id), commission_cents: 0,
          status: "scheduled", seats: [], version: 1, occ };
        s.classes.push(c);
        return classView(c);
      });
    },
    enroll(classId, customerId, key) {
      return once(key, () => {
        const c = findClass(classId);
        if (c.status !== "scheduled") fail("POLICY_REJECTED", "status");
        const customer = DEMO_CUSTOMERS.find((x) => x.id === customerId) ?? fail("NOT_FOUND", "customer_id");
        const live = c.seats.filter((x) => x.status !== "cancelled");
        if (live.length >= c.capacity) fail("POLICY_REJECTED", "capacity");
        if (live.some((x) => x.customer_id === customerId)) fail("POLICY_REJECTED", "seat");
        c.seats.push({ id: id("b6000000"), customer_id: customer.id, customer_name: customer.name, status: "booked", receivable_id: null, version: 1 });
        return classView(c);
      });
    },
    cancelSeat(seatId, version, key) {
      return once(key, () => {
        const c = state().classes.find((k) => k.seats.some((x) => x.id === seatId)) ?? fail("NOT_FOUND");
        const seat = c.seats.find((x) => x.id === seatId)!;
        if (seat.version !== version) fail("STALE_VERSION");
        if (seat.status !== "booked" || c.status !== "scheduled") fail("POLICY_REJECTED", "status");
        Object.assign(seat, { status: "cancelled", version: seat.version + 1 });
        return classView(c);
      });
    },
    cancelClass(input, key) {
      return once(key, () => {
        const c = findClass(input.id);
        if (c.version !== input.version) fail("STALE_VERSION");
        if (c.status !== "scheduled") fail("POLICY_REJECTED", "status");
        for (const seat of c.seats) if (seat.status === "booked") Object.assign(seat, { status: "cancelled", version: seat.version + 1 });
        Object.assign(c, { status: "cancelled", version: c.version + 1 });
        return classView(c);
      });
    },
    completeClass(input, attended, key) {
      return once(key, () => {
        const c = findClass(input.id);
        if (c.version !== input.version) fail("STALE_VERSION");
        if (c.status !== "scheduled") fail("POLICY_REJECTED", "status");
        if (Date.parse(c.starts_at) > state().clock) fail("POLICY_REJECTED", "starts_at");
        if (attended.some((sid) => !c.seats.some((x) => x.id === sid && x.status === "booked"))) fail("VALIDATION_ERROR", "attended_seat_ids");
        let n = 0;
        for (const seat of c.seats.filter((x) => x.status === "booked")) {
          const present = attended.includes(seat.id);
          n += present ? 1 : 0;
          Object.assign(seat, { status: present ? "attended" : "no_show", receivable_id: present && c.seat_price_cents > 0 ? id("b3000000") : null, version: seat.version + 1 });
        }
        Object.assign(c, { status: "completed", version: c.version + 1 });
        const base = n * c.seat_price_cents;
        state().entries.push({ id: id("b4000000"), professional_id: c.professional_id, professional_name: c.professional_name, booking_id: null, class_id: c.id, kind: "accrual",
          base_cents: base, bps: c.commission_bps, amount_cents: commission(base, c.commission_bps), reversal_of: null, reversed: false, created_at: ts() });
        return classView(c);
      });
    },
    async commissions(period) {
      const s = state();
      const [a, z] = [Date.parse(period.starts_at), Date.parse(period.ends_at)];
      const entries = s.entries.filter((e) => Date.parse(e.created_at) >= a && Date.parse(e.created_at) < z)
        .map((e) => ({ ...e, reversed: s.entries.some((x) => x.reversal_of === e.id) }));
      const pros = [...new Set(entries.map((e) => e.professional_id))].map((pid) => {
        const mine = entries.filter((e) => e.professional_id === pid);
        const accrued = mine.filter((e) => e.kind === "accrual").reduce((t, e) => t + e.amount_cents, 0);
        const reversed = mine.filter((e) => e.kind === "reversal").reduce((t, e) => t + e.amount_cents, 0);
        return { professional_id: pid, professional_name: findRes(pid)?.name ?? "", base_cents: mine.filter((e) => e.kind === "accrual").reduce((t, e) => t + e.base_cents, 0),
          accrued_cents: accrued, reversed_cents: reversed, net_cents: accrued + reversed, entries: mine.length };
      }).sort((x, y) => x.professional_name.localeCompare(y.professional_name));
      return clone({ professionals: pros, entries: [...entries].reverse() });
    },
    reverseCommission(entryId, key) {
      return once(key, () => {
        const s = state();
        const e = s.entries.find((x) => x.id === entryId) ?? fail("NOT_FOUND");
        if (e.kind !== "accrual") fail("POLICY_REJECTED", "kind");
        if (s.entries.some((x) => x.reversal_of === e.id)) fail("POLICY_REJECTED", "reversed");
        const r: TeamCommissionEntry = { ...e, id: id("b4000000"), kind: "reversal", amount_cents: -e.amount_cents, reversal_of: e.id, reversed: false, created_at: ts() };
        s.entries.push(r);
        return clone(r);
      });
    },
  };
}
