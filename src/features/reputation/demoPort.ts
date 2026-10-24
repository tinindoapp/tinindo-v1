// EMULAÇÃO de Avaliações para a demonstração sem servidor: mesmas regras do banco (uma por atendimento concluído do
// cliente vinculado, em 30 dias; resposta do profissional sem mexer na nota; denúncia não esconde; média só com 3+;
// competência certificada sempre falsa; autor nunca aparece). Nada sai do navegador.
import { DEFAULT_MESSAGES, ERROR_STATUS, type ErrorCode, RETRYABLE } from "@contracts";
import { FIXED_NOW, tenantA } from "@contracts/fixtures.ts";
import { ApiError } from "../../lib/api/client.ts";
import type { CustomerReviewsPort, OwnerReviewsPort, PublicReviewsPort, ReviewOwnerList, ReviewPending } from "./port.ts";

function fail(code: ErrorCode, field?: string): never {
  throw new ApiError(code, DEFAULT_MESSAGES[code], ERROR_STATUS[code], crypto.randomUUID(), RETRYABLE.has(code), field);
}
const clone = <T>(v: T): T => structuredClone(v);
type Review = ReviewOwnerList["reviews"][number];
const RULES = { window_days: 30, min_reviews_for_average: 3, body_max: 600 };
const PENDING: ReviewPending["pending"] = [
  { booking_id: "90000000-0000-4000-8000-0000000000e1", tenant_name: tenantA.name, service_name: "Corte", ended_at: "2026-10-18T13:30:00Z", review_until: "2026-11-17T13:30:00Z" },
  { booking_id: "90000000-0000-4000-8000-0000000000e2", tenant_name: tenantA.name, service_name: "Barba", ended_at: "2026-10-12T15:20:00Z", review_until: "2026-11-11T15:20:00Z" },
];
interface State { reviews: (Review & { booking_id: string | null; mine: boolean })[]; seq: number; clock: number; reports: Set<string> }
let shared: State | null = null;
const seedReview = (n: number, rating: number, body: string, month: string): State["reviews"][number] => ({
  id: `91000000-0000-4000-8000-00000000000${n}`, rating, body, service_name: "Corte", service_month: month, verified_booking: true, reply: null,
  created_at: `${month}-15T12:00:00Z`, status: "published", version: 1, hidden_reason: null, open_reports: 0, booking_id: null, mine: false,
});
const state = (): State => (shared ??= { reviews: [seedReview(1, 5, "Pontual e caprichoso.", "2026-09"), seedReview(2, 4, "Bom corte, recomendo.", "2026-08")], seq: 10, clock: Date.parse(FIXED_NOW), reports: new Set() });
const ts = () => new Date((state().clock += 1000)).toISOString().replace(/\.\d{3}Z$/, "Z");
/** Só para testes. */
export function resetDemoState() {
  shared = null;
}
function summary() {
  const pub = state().reviews.filter((r) => r.status === "published");
  const avg = pub.length >= RULES.min_reviews_for_average ? Math.round((pub.reduce((a, r) => a + r.rating, 0) / pub.length) * 10) / 10 : null;
  return { identity_verified: false, completed_bookings: 12, reviews_count: pub.length, rating_average: avg, certified_competence: false as const };
}
const strip = ({ booking_id: _b, mine: _m, ...r }: State["reviews"][number]) => r;
const pub = ({ status: _s, version: _v, hidden_reason: _h, open_reports: _o, ...r }: Review) => r;

export function createDemoOwnerPort(): OwnerReviewsPort {
  return {
    kind: "demo",
    async list() {
      return clone({ rules: RULES, summary: summary(), reviews: state().reviews.filter((r) => r.status !== "withdrawn").map(strip).sort((a, b) => b.created_at.localeCompare(a.created_at)) });
    },
    async reply(id, version, body) {
      const r = state().reviews.find((x) => x.id === id);
      if (!r || r.status === "withdrawn") fail("NOT_FOUND");
      if (r.version !== version) fail("STALE_VERSION");
      if (body.trim().length < 2) fail("VALIDATION_ERROR", "body");
      Object.assign(r, { reply: { body: body.trim(), at: ts() }, version: r.version + 1 });
    },
    async report(id) {
      const r = state().reviews.find((x) => x.id === id && x.status === "published");
      if (!r) fail("NOT_FOUND");
      if (!state().reports.has(id)) {
        state().reports.add(id);
        r.open_reports += 1;
      }
    },
  };
}

export function createDemoCustomerPort(): CustomerReviewsPort {
  return {
    kind: "demo",
    async pending() {
      const s = state();
      return clone({ rules: RULES, pending: PENDING.filter((p) => !s.reviews.some((r) => r.booking_id === p.booking_id)),
        mine: s.reviews.filter((r) => r.mine).map((r) => ({ ...pub(strip(r)), status: r.status, version: r.version, tenant_name: tenantA.name })) });
    },
    async submit(bookingId, rating, body) {
      const s = state();
      const p = PENDING.find((x) => x.booking_id === bookingId);
      if (!p) fail("NOT_FOUND");
      if (s.reviews.some((r) => r.booking_id === bookingId)) fail("POLICY_REJECTED", "already_reviewed");
      if (rating < 1 || rating > 5) fail("VALIDATION_ERROR", "rating");
      s.reviews.push({ id: `91000000-0000-4000-8000-${String(++s.seq).padStart(12, "0")}`, rating, body: body?.trim() || null, service_name: p.service_name,
        service_month: p.ended_at.slice(0, 7), verified_booking: true, reply: null, created_at: ts(), status: "published", version: 1, hidden_reason: null, open_reports: 0,
        booking_id: bookingId, mine: true });
    },
    async withdraw(id) {
      const r = state().reviews.find((x) => x.id === id && x.mine);
      if (!r) fail("NOT_FOUND");
      if (r.status === "published") Object.assign(r, { status: "withdrawn", version: r.version + 1 });
    },
  };
}

export function createDemoPublicPort(): PublicReviewsPort {
  return {
    kind: "demo",
    async list(slug) {
      if (slug !== "barbearia-exemplo-a") fail("NOT_FOUND");
      return clone({ rules: RULES, summary: summary(), reviews: state().reviews.filter((r) => r.status === "published").map((r) => pub(strip(r))).sort((a, b) => b.created_at.localeCompare(a.created_at)) });
    },
  };
}
