// EMULAÇÃO do motor de agenda (P03) e da cotação (P05) sobre as fixtures do contrato v1.
// Só para demonstração offline e testes: nada sai do navegador e nada persiste além da aba.
// Reproduz o comportamento do contrato que a tela precisa tratar: conflito de horário (409),
// versão desatualizada (409), idempotência (repetição devolve o mesmo resultado) e cotação com prazo.
import {
  AvailabilityListInput,
  type Booking,
  BookingCancelInput,
  BookingCompleteInput,
  BookingCreateInput,
  BookingRescheduleInput,
  DEFAULT_MESSAGES,
  ERROR_STATUS,
  type ErrorCode,
  PricingQuoteInput,
  type ProviderService,
  type Quote,
  RETRYABLE,
  ScheduleBlockCreateInput,
  ScheduleBlockRemoveInput,
  ScheduleRulesSaveInput,
  type ScheduleSettings,
  type TimeRange,
} from "@contracts";
import { FIXED_NOW, FX, services as fixtureServices, tenantA } from "@contracts/fixtures.ts";
import type { z } from "zod";
import { ApiError } from "../../lib/api/client.ts";
import { ACTIVE_STATUSES, type DayPlan } from "./agenda.ts";
import { addDays, localParts, toZonedIso, zonedInstant } from "./time.ts";
import {
  DEMO_BLOCKS,
  DEMO_CUSTOMERS,
  DEMO_OFF_PEAK,
  DEMO_WEEKLY_HOURS,
  demoBookings,
} from "./demoData.ts";
import type { SchedulingPort } from "./port.ts";

/** Simulação de concorrência para demonstrar e testar os 409 (`?simular=conflito|versao`). */
export type Simulation = "conflito" | "versao" | null;

const SLOT_STEP_MIN = 15;
const QUOTE_TTL_MIN = 10;
const MIN = 60_000;

function fail(code: ErrorCode, field?: string): never {
  throw new ApiError(code, DEFAULT_MESSAGES[code], ERROR_STATUS[code], crypto.randomUUID(), RETRYABLE.has(code), field);
}

function parse<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const r = schema.safeParse(input);
  if (!r.success) fail("VALIDATION_ERROR", r.error.issues[0]?.path.join("."));
  return r.data;
}

function stableHash(value: unknown): string {
  return JSON.stringify(value, (_k, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );
}

export interface FixturePortOptions {
  simulate?: Simulation;
  /** Atraso artificial (ms) para tornar estados de carregamento observáveis. */
  latencyMs?: number;
}

export function createFixturePort(options: FixturePortOptions = {}): SchedulingPort {
  const tz = tenantA.timezone;
  const now = new Date(FIXED_NOW);
  const services: ProviderService[] = fixtureServices.filter((s) => s.tenant_id === FX.tenants.A);
  let bookings: Booking[] = demoBookings();
  const quotes = new Map<string, Quote>();
  const idem = new Map<string, { hash: string; result: Booking }>();
  let simulate = options.simulate ?? null;
  let seq = 0;
  // Expediente e bloqueios editáveis na aba (emulação de schedule.* do P03).
  let hours: Record<number, [string, string][]> = Object.fromEntries(
    Object.entries(DEMO_WEEKLY_HOURS).map(([d, h]) => [Number(d), h.open.map(([a, b]) => [a, b] as [string, string])]),
  );
  let resourceVersion = 1;
  let blocks = DEMO_BLOCKS.map((b, i) => ({
    id: `70000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
    version: 1,
    removed: false,
    range: {
      starts_at: toZonedIso(zonedInstant(b.date, b.from, tz), tz),
      ends_at: toZonedIso(zonedInstant(b.date, b.to, tz), tz),
    },
    label: b.label,
  }));
  const commandIdem = new Map<string, string>();

  /** Idempotência dos comandos de expediente: mesma chave + mesmo pedido não repete o efeito. */
  function once(op: string, key: string, input: unknown): boolean {
    const id = `${op}:${key}`;
    const hash = stableHash(input);
    const prior = commandIdem.get(id);
    if (prior !== undefined) {
      if (prior !== hash) fail("IDEMPOTENCY_MISMATCH");
      return false;
    }
    commandIdem.set(id, hash);
    return true;
  }

  function settingsNow(): ScheduleSettings {
    const rules = Object.entries(hours).flatMap(([d, list]) =>
      list.map(([local_start, local_end]) => ({ weekday: Number(d), local_start, local_end })),
    );
    rules.sort((a, b) => a.weekday - b.weekday || a.local_start.localeCompare(b.local_start));
    return { resource_id: FX.resources.A, resource_version: resourceVersion, timezone: tz, rules };
  }

  const delay = <T>(value: T): Promise<T> =>
    new Promise((resolve) => setTimeout(() => resolve(structuredClone(value)), options.latencyMs ?? 0));

  const service = (id: string) => services.find((s) => s.id === id && s.active) ?? fail("NOT_FOUND", "service_id");
  const booking = (id: string) => bookings.find((b) => b.id === id) ?? fail("NOT_FOUND", "booking_id");

  function plan(date: string): DayPlan {
    const open = [...(hours[localParts(zonedInstant(date, "12:00", tz), tz).weekday] ?? [])].sort((a, b) => a[0].localeCompare(b[0]));
    const range = (from: string, to: string): TimeRange => ({
      starts_at: toZonedIso(zonedInstant(date, from, tz), tz),
      ends_at: toZonedIso(zonedInstant(date, to, tz), tz),
    });
    const dayStart = zonedInstant(date, "00:00", tz).getTime();
    const dayEnd = zonedInstant(addDays(date, 1), "00:00", tz).getTime();
    return {
      date,
      open: open.map(([a, b]) => range(a, b)),
      // Pausa = lacuna entre períodos abertos do mesmo dia (mesma regra do servidor).
      pauses: open.slice(1).map(([a], i) => range(open[i]![1], a)),
      blocks: blocks
        .filter((b) => !b.removed && Date.parse(b.range.starts_at) < dayEnd && Date.parse(b.range.ends_at) > dayStart)
        .map(({ id, version, range: r, label }) => ({ id, version, range: r, label })),
    };
  }

  function datesIn(window: TimeRange): string[] {
    const first = localParts(window.starts_at, tz).date;
    const out: string[] = [];
    for (let d = first; zonedInstant(d, "00:00", tz).getTime() < Date.parse(window.ends_at); d = addDays(d, 1)) out.push(d);
    return out;
  }

  /** Ocupação com intervalos (buffers) do serviço, como o P03 deve fazer. */
  function occupied(b: Pick<Booking, "starts_at" | "ends_at" | "service_id">): [number, number] {
    const s = services.find((x) => x.id === b.service_id);
    return [
      Date.parse(b.starts_at) - (s?.buffer_before_min ?? 0) * MIN,
      Date.parse(b.ends_at) + (s?.buffer_after_min ?? 0) * MIN,
    ];
  }

  function fits(serviceId: string, slot: TimeRange, ignoreId?: string): "ok" | "conflict" | "closed" {
    const start = Date.parse(slot.starts_at);
    const end = Date.parse(slot.ends_at);
    if (start < now.getTime()) return "closed";
    const p = plan(localParts(slot.starts_at, tz).date);
    const inside = p.open.some((o) => start >= Date.parse(o.starts_at) && end <= Date.parse(o.ends_at));
    const blocked = p.blocks.some((b) => start < Date.parse(b.range.ends_at) && Date.parse(b.range.starts_at) < end);
    if (!inside || blocked) return "closed";
    const [ns, ne] = occupied({ ...slot, service_id: serviceId });
    const clash = bookings.some((b) => {
      if (b.id === ignoreId || !ACTIVE_STATUSES.includes(b.status)) return false;
      const [s, e] = occupied(b);
      return ns < e && s < ne;
    });
    return clash ? "conflict" : "ok";
  }

  function price(svc: ProviderService, slot: TimeRange): Pick<Quote, "final_price_cents" | "rule_version" | "reason_code"> {
    const lp = localParts(slot.starts_at, tz);
    const r = DEMO_OFF_PEAK;
    const inWindow = lp.weekday === r.weekday && lp.time >= r.from && lp.time < r.to;
    if (!inWindow) return { final_price_cents: svc.base_price_cents, rule_version: null, reason_code: "BASE_PRICE" };
    // round_half_up em inteiros; piso do serviço prevalece (regra do P05, doc06).
    const candidate = Math.floor((svc.base_price_cents * (10_000 - r.discount_bps) + 5_000) / 10_000);
    if (candidate < svc.min_price_cents) {
      return { final_price_cents: svc.min_price_cents, rule_version: r.rule_version, reason_code: "FLOOR_APPLIED" };
    }
    return { final_price_cents: candidate, rule_version: r.rule_version, reason_code: "OFF_PEAK_APPROVED" };
  }

  function checkQuote(quoteId: string | null, serviceId: string, slot: TimeRange): number | null {
    if (!quoteId) return null;
    const q = quotes.get(quoteId);
    if (
      !q ||
      q.service_id !== serviceId ||
      Date.parse(q.slot.starts_at) !== Date.parse(slot.starts_at) ||
      Date.parse(q.expires_at) <= now.getTime()
    ) {
      fail("POLICY_REJECTED", "quote_id");
    }
    return q.final_price_cents;
  }

  function idempotent(op: string, key: string, input: unknown, run: () => Booking): Booking {
    const id = `${op}:${key}`;
    const hash = stableHash(input);
    const prior = idem.get(id);
    if (prior) {
      if (prior.hash !== hash) fail("IDEMPOTENCY_MISMATCH");
      return prior.result;
    }
    const result = run();
    idem.set(id, { hash, result: structuredClone(result) });
    return result;
  }

  function update(id: string, patch: Partial<Booking>): Booking {
    const current = booking(id);
    const next = { ...current, ...patch, version: current.version + 1 };
    bookings = bookings.map((b) => (b.id === id ? next : b));
    return next;
  }

  /** Simula outra pessoa confirmando o mesmo horário um instante antes. */
  function takeSimulatedConflict(serviceId: string, slot: TimeRange) {
    if (simulate !== "conflito") return;
    simulate = null;
    bookings.push({
      id: `60000000-0000-4000-8000-${String(900 + ++seq).padStart(12, "0")}`,
      tenant_id: FX.tenants.A, resource_id: FX.resources.A, customer_id: null, service_id: serviceId,
      starts_at: slot.starts_at, ends_at: slot.ends_at, status: "confirmed", hold_expires_at: null,
      price_quote_id: null, agreed_price_cents: null, source: "public_link", version: 1,
    });
    fail("SLOT_CONFLICT", "slot");
  }

  /** Simula edição concorrente do mesmo atendimento em outro aparelho. */
  function takeSimulatedStale(id: string) {
    if (simulate !== "versao") return;
    simulate = null;
    update(id, {});
    fail("STALE_VERSION", "expected_version");
  }

  function checkVersion(b: Booking, expected: number) {
    if (b.version !== expected) fail("STALE_VERSION", "expected_version");
  }

  return {
    kind: "fixture",
    now: () => new Date(now),
    context: () => delay({ tenantId: tenantA.id, tenantName: tenantA.name, timezone: tz, resourceId: FX.resources.A }),
    listServices: () => delay(services),
    listCustomers: () => delay(DEMO_CUSTOMERS.map((c) => ({ ...c }))),
    listBookings: (window) =>
      delay(
        bookings
          .filter((b) => Date.parse(b.starts_at) >= Date.parse(window.starts_at) && Date.parse(b.starts_at) < Date.parse(window.ends_at))
          .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at)),
      ),
    getBooking: async (id) => delay(booking(id)),
    dayPlans: (window) => delay(datesIn(window).map(plan)),

    async availability(raw) {
      const input = parse(AvailabilityListInput, raw);
      const svc = service(input.service_id);
      const slots: TimeRange[] = [];
      for (const date of datesIn(input.window)) {
        for (const o of plan(date).open) {
          for (let t = Date.parse(o.starts_at); t + svc.duration_min * MIN <= Date.parse(o.ends_at); t += SLOT_STEP_MIN * MIN) {
            const slot = { starts_at: toZonedIso(t, tz), ends_at: toZonedIso(t + svc.duration_min * MIN, tz) };
            if (t >= Date.parse(input.window.starts_at) && fits(svc.id, slot) === "ok") slots.push(slot);
          }
        }
      }
      return delay({ slots: slots.slice(0, 500), timezone: tz });
    },

    settings: () => delay(settingsNow()),
    async saveRules(raw, key) {
      const input = parse(ScheduleRulesSaveInput, raw);
      if (once("schedule.rules_save", key, input)) {
        if (input.expected_version !== resourceVersion) fail("STALE_VERSION", "expected_version");
        const next: Record<number, [string, string][]> = {};
        for (const r of input.rules) (next[r.weekday] ??= []).push([r.local_start, r.local_end]);
        for (const list of Object.values(next)) {
          list.sort((a, b) => a[0].localeCompare(b[0]));
          if (list.some(([, end], i) => i + 1 < list.length && end > list[i + 1]![0])) fail("VALIDATION_ERROR", "rules");
        }
        hours = next;
        resourceVersion += 1;
      }
      return delay(settingsNow());
    },
    async createBlock(raw, key) {
      const input = parse(ScheduleBlockCreateInput, raw);
      if (!once("schedule.block_create", key, input)) return delay(undefined);
      const [s0, e0] = [Date.parse(input.range.starts_at), Date.parse(input.range.ends_at)];
      const clash = bookings.some((b) => {
        if (!ACTIVE_STATUSES.includes(b.status)) return false;
        const [s, e] = occupied(b);
        return s0 < e && s < e0;
      });
      if (clash) {
        commandIdem.delete(`schedule.block_create:${key}`);
        fail("SLOT_CONFLICT", "range");
      }
      blocks = [...blocks, {
        id: `70000000-0000-4000-8000-${String(100 + ++seq).padStart(12, "0")}`,
        version: 1, removed: false, range: input.range, label: input.label,
      }];
      return delay(undefined);
    },
    async removeBlock(raw, key) {
      const input = parse(ScheduleBlockRemoveInput, raw);
      if (!once("schedule.block_remove", key, input)) return delay(undefined);
      const b = blocks.find((x) => x.id === input.block_id && !x.removed) ?? fail("NOT_FOUND", "block_id");
      if (b.version !== input.expected_version) fail("STALE_VERSION", "expected_version");
      blocks = blocks.map((x) => (x.id === b.id ? { ...x, removed: true, version: x.version + 1 } : x));
      return delay(undefined);
    },

    async quote(raw) {
      const input = parse(PricingQuoteInput, raw);
      const svc = service(input.service_id);
      const q: Quote = {
        quote_id: crypto.randomUUID(),
        service_id: svc.id,
        resource_id: input.resource_id,
        slot: input.slot,
        currency: "BRL",
        base_price_cents: svc.base_price_cents,
        ...price(svc, input.slot),
        expires_at: toZonedIso(now.getTime() + QUOTE_TTL_MIN * MIN, tz),
      };
      quotes.set(q.quote_id, q);
      return delay(q);
    },

    async create(raw, key) {
      const input = parse(BookingCreateInput, raw);
      const result = idempotent("booking.create", key, input, () => {
        const svc = service(input.service_id);
        takeSimulatedConflict(svc.id, input.slot);
        const fit = fits(svc.id, input.slot);
        if (fit === "conflict") fail("SLOT_CONFLICT", "slot");
        if (fit === "closed") fail("POLICY_REJECTED", "slot");
        const agreed = checkQuote(input.quote_id, svc.id, input.slot);
        const created: Booking = {
          id: `60000000-0000-4000-8000-${String(500 + ++seq).padStart(12, "0")}`,
          tenant_id: FX.tenants.A,
          resource_id: input.resource_id,
          customer_id: input.customer_id,
          service_id: svc.id,
          starts_at: input.slot.starts_at,
          ends_at: input.slot.ends_at,
          status: input.mode === "confirm" ? "confirmed" : "held",
          hold_expires_at: input.mode === "hold" ? toZonedIso(now.getTime() + QUOTE_TTL_MIN * MIN, tz) : null,
          price_quote_id: input.quote_id,
          agreed_price_cents: agreed ?? svc.base_price_cents,
          source: "owner",
          version: 1,
        };
        bookings.push(created);
        return created;
      });
      return delay(result);
    },

    async reschedule(raw, key) {
      const input = parse(BookingRescheduleInput, raw);
      const result = idempotent("booking.reschedule", key, input, () => {
        const current = booking(input.booking_id);
        takeSimulatedStale(current.id);
        checkVersion(current, input.expected_version);
        if (current.status !== "held" && current.status !== "confirmed") fail("POLICY_REJECTED");
        takeSimulatedConflict(current.service_id, input.slot);
        const fit = fits(current.service_id, input.slot, current.id);
        if (fit === "conflict") fail("SLOT_CONFLICT", "slot");
        if (fit === "closed") fail("POLICY_REJECTED", "slot");
        const agreed = checkQuote(input.quote_id, current.service_id, input.slot);
        return update(current.id, {
          starts_at: input.slot.starts_at,
          ends_at: input.slot.ends_at,
          price_quote_id: input.quote_id ?? current.price_quote_id,
          agreed_price_cents: agreed ?? current.agreed_price_cents,
        });
      });
      return delay(result);
    },

    async cancel(raw, key) {
      const input = parse(BookingCancelInput, raw);
      const result = idempotent("booking.cancel", key, input, () => {
        const current = booking(input.booking_id);
        takeSimulatedStale(current.id);
        checkVersion(current, input.expected_version);
        if (current.status !== "held" && current.status !== "confirmed") fail("POLICY_REJECTED");
        return update(current.id, { status: "cancelled", hold_expires_at: null });
      });
      return delay(result);
    },

    async complete(raw, key) {
      const input = parse(BookingCompleteInput, raw);
      const result = idempotent("booking.complete", key, input, () => {
        const current = booking(input.booking_id);
        checkVersion(current, input.expected_version);
        if (current.status !== "confirmed" || Date.parse(current.starts_at) > now.getTime()) fail("POLICY_REJECTED");
        return update(current.id, { status: "completed" });
      });
      return delay(result);
    },
  };
}
