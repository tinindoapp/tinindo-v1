// EMULAÇÃO do Domicílio para a demonstração sem servidor. Mesmas regras do banco que a tela explica: zona por bairro e
// prefixos de CEP de 5 dígitos, um CEP numa zona só; área = zona ativa dentro da distância máxima declarada; o
// deslocamento termina quando o atendimento começa e ocupa a agenda; se não couber, nada muda; janela de chegada;
// cancelar um atendimento pede recálculo. Nenhum endereço, coordenada ou rastreamento.
import { DEFAULT_MESSAGES, ERROR_STATUS, type ErrorCode, RETRYABLE } from "@contracts";
import { ApiError } from "../../lib/api/client.ts";
import type { FieldConfig, FieldPort, FieldRoute, FieldSettings, FieldStop, FieldTravelTime, FieldZone } from "./port.ts";

function fail(code: ErrorCode, field?: string): never {
  throw new ApiError(code, DEFAULT_MESSAGES[code], ERROR_STATUS[code], crypto.randomUUID(), RETRYABLE.has(code), field);
}
const TZ = "America/Sao_Paulo";
const TODAY = "2026-10-20";
const MIN = 60_000;
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
/** Horário local de São Paulo (sem horário de verão: UTC−3). */
const at = (day: string, hhmm: string) => Date.parse(`${day}T${hhmm}:00-03:00`);
const localDay = (ms: number) => iso(ms - 3 * 60 * MIN).slice(0, 10);
const clone = <T>(v: T): T => structuredClone(v);

interface Zone { id: string; name: string; ceps: string[]; km: number; base: number; active: boolean; version: number }
interface Booking { id: string; customer: string; service: string; start: number; end: number; buffer: number; status: FieldStop["status"] }
interface Visit { id: string; booking_id: string; zone_id: string; cep5: string | null; travel: number | null; block: [number, number] | null; version: number }
interface State {
  settings: FieldSettings;
  zones: Zone[];
  travel: Map<string, number>;
  bookings: Booking[];
  visits: Visit[];
  idem: Map<string, unknown>;
  seq: number;
}
let shared: State | null = null;
const id = (p: string) => `${p}-0000-4000-8000-${String(++shared!.seq).padStart(12, "0")}`;
const pair = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

function seed(): State {
  shared = { settings: { enabled: true, default_travel_min: 30, same_zone_travel_min: 10, arrival_window_min: 30, max_km: 15, version: 2 },
    zones: [], travel: new Map(), bookings: [], visits: [], idem: new Map(), seq: 0 };
  const s = shared;
  const z = (name: string, ceps: string[], km: number, base: number, active = true) => {
    const v: Zone = { id: id("f1000000"), name, ceps, km, base, active, version: 1 };
    s.zones.push(v);
    return v;
  };
  const centro = z("Centro", ["01001", "01002", "01010"], 2, 20);
  const pinheiros = z("Pinheiros", ["05401", "05402"], 8, 35);
  z("Vila Mariana", ["04101", "04102"], 6, 30);
  z("Alphaville", ["06454"], 25, 60);
  s.travel.set(pair(centro.id, pinheiros.id), 25);
  const b = (day: string, customer: string, service: string, start: string, min: number, status: Booking["status"] = "confirmed") =>
    s.bookings.push({ id: id("f2000000"), customer, service, start: at(day, start), end: at(day, start) + min * MIN, buffer: 10, status });
  for (const day of [TODAY, addDay(TODAY, 1)]) {
    b(day, "Ana Souza", "Corte", "09:00", 30);
    b(day, "Carlos Lima", "Barba", "10:30", 30);
    b(day, "Bia Rocha", "Escova", "14:00", 45);
    b(day, "Duda Alves", "Corte", "16:00", 30);
  }
  const visit = (bk: Booking, zone: Zone, cep5: string) => s.visits.push({ id: id("f3000000"), booking_id: bk.id, zone_id: zone.id, cep5, travel: null, block: null, version: 1 });
  visit(s.bookings[0]!, centro, "01001");
  visit(s.bookings[1]!, pinheiros, "05401");
  rebuild(TODAY);
  return s;
}
function addDay(day: string, n: number) {
  return new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}
const state = () => shared ?? seed();
/** Só para testes: volta ao estado inicial. */
export function resetDemoState() {
  shared = null;
}

const zoneView = (z: Zone): FieldZone => {
  const s = state().settings;
  return { id: z.id, name: z.name, cep_prefixes: [...z.ceps], distance_km: z.km, travel_from_base_min: z.base, active: z.active,
    in_area: z.active && (s.max_km === null || z.km <= s.max_km), version: z.version };
};
const travelView = (): FieldTravelTime[] => [...state().travel].map(([k, minutes]) => {
  const [zone_a = "", zone_b = ""] = k.split("|");
  return { zone_a, zone_b, minutes };
});
function travelMin(from: string | null, to: string): number {
  const s = state();
  if (from === null) return s.zones.find((z) => z.id === to)!.base;
  if (from === to) return s.settings.same_zone_travel_min;
  return s.travel.get(pair(from, to)) ?? s.settings.default_travel_min;
}
const live = (b: Booking) => b.status === "held" || b.status === "confirmed";

/** Refaz os deslocamentos do dia, tudo ou nada (como app.fs_rebuild_day). */
function rebuild(day: string): number {
  const s = state();
  const inDay = (b: Booking) => localDay(b.start) === day;
  const visits = s.visits.filter((v) => inDay(s.bookings.find((b) => b.id === v.booking_id)!));
  const draft = new Map(visits.map((v) => [v.id, { travel: null as number | null, block: null as [number, number] | null }]));
  const active = visits.map((v) => ({ v, b: s.bookings.find((b) => b.id === v.booking_id)! })).filter((x) => live(x.b)).sort((x, y) => x.b.start - y.b.start);
  let prev: string | null = null;
  const blocks: [number, number][] = [];
  for (const { v, b } of active) {
    const t = travelMin(prev, v.zone_id);
    if (t > 0) {
      const range: [number, number] = [b.start - t * MIN, b.start];
      const hits = s.bookings.some((o) => live(o) && o.start < range[1] && o.end + o.buffer * MIN > range[0]) || blocks.some((k) => k[0] < range[1] && k[1] > range[0]);
      if (hits) fail("SLOT_CONFLICT", "travel");
      blocks.push(range);
      draft.set(v.id, { travel: t, block: range });
    } else draft.set(v.id, { travel: 0, block: null });
    prev = v.zone_id;
  }
  for (const v of visits) Object.assign(v, draft.get(v.id));
  return active.length;
}

function stopView(v: Visit): FieldStop {
  const s = state();
  const b = s.bookings.find((x) => x.id === v.booking_id)!;
  const z = s.zones.find((x) => x.id === v.zone_id)!;
  return { visit_id: v.id, booking_id: b.id, status: b.status, zone_id: z.id, zone_name: z.name, cep5: v.cep5, customer_name: b.customer, service_name: b.service,
    travel_min: v.travel, depart_at: v.block ? iso(v.block[0]) : null, arrival_from: iso(b.start - s.settings.arrival_window_min * MIN), arrival_to: iso(b.start),
    starts_at: iso(b.start), ends_at: iso(b.end), version: v.version };
}

/** Repetir com a mesma chave devolve a mesma resposta; um erro desfaz tudo (como a transação do banco). */
async function command<T>(key: string, run: () => T): Promise<T> {
  const s = state();
  if (s.idem.has(key)) return clone(s.idem.get(key) as T);
  const snapshot = clone({ ...s, idem: undefined, travel: [...s.travel] });
  try {
    const out = run();
    s.idem.set(key, clone(out));
    return clone(out);
  } catch (e) {
    Object.assign(s, { ...snapshot, idem: s.idem, travel: new Map(snapshot.travel) });
    throw e;
  }
}

export function createDemoPort(): FieldPort {
  return {
    kind: "demo",
    today: () => TODAY,
    async config(): Promise<FieldConfig> {
      const s = state();
      return clone({ settings: s.settings, zones: s.zones.map(zoneView), travel_times: travelView(), timezone: TZ });
    },
    saveSettings: (input, key) => command(key, () => {
      const s = state();
      if (input.expected_version != null && input.expected_version !== s.settings.version) fail("STALE_VERSION");
      s.settings = { enabled: input.enabled ?? true, default_travel_min: input.default_travel_min, same_zone_travel_min: input.same_zone_travel_min,
        arrival_window_min: input.arrival_window_min, max_km: input.max_km ?? null, version: s.settings.version + 1 };
      return s.settings;
    }),
    saveZone: (input, key) => command(key, () => {
      const s = state();
      const ceps = input.cep_prefixes ?? [];
      if (ceps.some((c) => !/^\d{5}$/.test(c)) || new Set(ceps).size !== ceps.length || !input.name.trim()) fail("VALIDATION_ERROR", "zone");
      const z = input.zone_id ? s.zones.find((x) => x.id === input.zone_id) : undefined;
      if (input.zone_id && !z) fail("NOT_FOUND");
      if (z && input.expected_version != null && input.expected_version !== z.version) fail("STALE_VERSION");
      const others = s.zones.filter((x) => x.id !== z?.id);
      if (others.some((x) => x.name.toLowerCase() === input.name.trim().toLowerCase())) fail("POLICY_REJECTED", "name");
      if ((input.active ?? true) && others.some((x) => x.active && x.ceps.some((c) => ceps.includes(c)))) fail("POLICY_REJECTED", "cep_prefixes");
      const next: Zone = { id: z?.id ?? id("f1000000"), name: input.name.trim(), ceps, km: input.distance_km, base: input.travel_from_base_min,
        active: input.active ?? true, version: (z?.version ?? 0) + 1 };
      if (z) Object.assign(z, next);
      else s.zones.push(next);
      return zoneView(next);
    }),
    saveTravel: (a, b, minutes, key) => command(key, () => {
      const s = state();
      if (a === b) fail("VALIDATION_ERROR", "zone_b");
      if (!s.zones.some((z) => z.id === a) || !s.zones.some((z) => z.id === b)) fail("NOT_FOUND");
      if (minutes === null) s.travel.delete(pair(a, b));
      else s.travel.set(pair(a, b), minutes);
      return travelView();
    }),
    async zoneFor(cep) {
      const d = cep.replace(/\D/g, "");
      if (d.length < 5) fail("VALIDATION_ERROR", "cep");
      const cep5 = d.slice(0, 5);
      const z = state().zones.find((x) => x.active && x.ceps.includes(cep5));
      const view = z ? zoneView(z) : null;
      return { cep5, zone: view, in_area: view?.in_area ?? false };
    },
    async route(day): Promise<FieldRoute> {
      const s = state();
      const inDay = s.bookings.filter((b) => localDay(b.start) === day);
      const stops = s.visits.filter((v) => inDay.some((b) => b.id === v.booking_id)).map(stopView)
        .filter((x) => x.status !== "cancelled" && x.status !== "expired").sort((x, y) => x.starts_at.localeCompare(y.starts_at));
      return clone({ day, timezone: TZ, arrival_window_min: s.settings.arrival_window_min, stops,
        needs_rebuild: stops.some((x) => (x.status === "held" || x.status === "confirmed") && x.travel_min === null),
        bookings: inDay.filter(live).sort((x, y) => x.start - y.start).map((b) => ({ booking_id: b.id, starts_at: iso(b.start), customer_name: b.customer,
          service_name: b.service, is_visit: s.visits.some((v) => v.booking_id === b.id) })) });
    },
    attach: (bookingId, zoneId, cep5, key) => command(key, () => {
      const s = state();
      if (!s.settings.enabled) fail("POLICY_REJECTED", "disabled");
      const b = s.bookings.find((x) => x.id === bookingId);
      if (!b) fail("NOT_FOUND");
      if (!live(b)) fail("POLICY_REJECTED", "status");
      const z = s.zones.find((x) => x.id === zoneId);
      if (!z) fail("NOT_FOUND");
      if (!zoneView(z).in_area) fail("POLICY_REJECTED", "area");
      if (cep5 !== null && (!/^\d{5}$/.test(cep5) || (z.ceps.length > 0 && !z.ceps.includes(cep5)))) fail("VALIDATION_ERROR", "cep");
      let v = s.visits.find((x) => x.booking_id === b.id);
      if (v) Object.assign(v, { zone_id: z.id, cep5, version: v.version + 1 });
      else s.visits.push((v = { id: id("f3000000"), booking_id: b.id, zone_id: z.id, cep5, travel: null, block: null, version: 1 }));
      rebuild(localDay(b.start));
      return stopView(v);
    }),
    detach: (bookingId, key) => command(key, () => {
      const s = state();
      const v = s.visits.find((x) => x.booking_id === bookingId);
      if (!v) fail("NOT_FOUND");
      const b = s.bookings.find((x) => x.id === bookingId)!;
      s.visits = s.visits.filter((x) => x !== v);
      try {
        rebuild(localDay(b.start));
      } catch {
        // Tirar uma visita só encurta o roteiro; se algo não couber, o próximo recálculo avisa.
      }
    }),
    rebuild: (day, key) => command(key, () => rebuild(day)),
  };
}

/** Só para testes e para a demonstração de "cancelar na agenda": muda o status de um atendimento como o P03 faria. */
export function demoCancelBooking(bookingId: string) {
  const s = state();
  const b = s.bookings.find((x) => x.id === bookingId);
  if (!b) return;
  b.status = "cancelled";
  const v = s.visits.find((x) => x.booking_id === bookingId);
  if (v) Object.assign(v, { travel: null, block: null });
  // O banco solta o deslocamento da visita cancelada; as outras do dia mantêm o bloqueio e pedem recálculo.
  if (!v) return;
  for (const o of s.visits) {
    const ob = s.bookings.find((x) => x.id === o.booking_id)!;
    if (o !== v && localDay(ob.start) === localDay(b.start)) o.travel = null;
  }
}
