// EMULAÇÃO de Campanhas para a demonstração sem servidor. Mesmas regras do banco que a tela explica: público só com
// consentimento de marketing e sem atendimento futuro; aprovação cita o público visto (hash); controle sorteado;
// tetos de envio e gasto aplicados; sem canal, o passo fica para compartilhar; conversão medida; resultado por braço
// com intervalo de Wilson; veredito só pelo desenho (sem controle = observação); cancelar para o pendente.
import { type Campaign, CampaignApproveInput, type CampaignSegment, DEFAULT_MESSAGES, ERROR_STATUS, type ErrorCode, RETRYABLE } from "@contracts";
import { FIXED_NOW, FX, services as fixtureServices } from "@contracts/fixtures.ts";
import { ApiError } from "../../lib/api/client.ts";
import type { CampaignDetail, CampaignsPort, Preview } from "./port.ts";

function fail(code: ErrorCode, field?: string): never {
  throw new ApiError(code, DEFAULT_MESSAGES[code], ERROR_STATUS[code], crypto.randomUUID(), RETRYABLE.has(code), field);
}
const clone = <T>(v: T): T => structuredClone(v);
const DAY = 86_400_000;
interface DemoCustomer { id: string; name: string; marketing: boolean; lastVisitDays: number | null; credits: number; futureBooking: boolean }
const CUSTOMERS: DemoCustomer[] = [
  { id: FX.customers.abInA, name: "Ana Beatriz (exemplo)", marketing: true, lastVisitDays: 45, credits: 0, futureBooking: false },
  { id: FX.customers.guestInA, name: "Carlos (exemplo)", marketing: true, lastVisitDays: 70, credits: 2, futureBooking: false },
  ...["Daniela", "Eduardo", "Fernanda", "Gabriel", "Helena", "Igor", "Júlia", "Kauã"].map((n, i) => ({
    id: `d1000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`, name: `${n} (exemplo)`, marketing: i !== 6, lastVisitDays: i % 3 === 0 ? 20 : 60 + i * 5, credits: i === 2 ? 3 : 0, futureBooking: i === 5 })),
];
interface Member { customer_id: string; arm: "treatment" | "control"; converted: boolean; step: "manual" | "cancelled" | null }
interface State { campaigns: Campaign[]; members: Map<string, Member[]>; idem: Map<string, unknown>; seq: number; clock: number }
let shared: State | null = null;
const state = (): State => (shared ??= { campaigns: [], members: new Map(), idem: new Map(), seq: 0, clock: Date.parse(FIXED_NOW) });
const ts = () => new Date(state().clock).toISOString();
const id = (p: string) => `${p}-0000-4000-8000-${String(++state().seq).padStart(12, "0")}`;
/** Só para testes. */
export function resetDemoState() {
  shared = null;
}
const hash = (ids: string[]) => {
  let h = 7;
  for (const ch of [...ids].sort().join(",")) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h.toString(16).padStart(8, "0").repeat(8);
};
const once = async <T>(key: string, run: () => T): Promise<T> => {
  const s = state();
  if (s.idem.has(key)) return clone(s.idem.get(key)) as T;
  const v = run();
  s.idem.set(key, clone(v));
  return clone(v);
};
function eligible(segment: CampaignSegment): DemoCustomer[] {
  const s = state();
  const busy = new Set(s.campaigns.filter((c) => c.status === "running").flatMap((c) => (s.members.get(c.id) ?? []).map((m) => m.customer_id)));
  return CUSTOMERS.filter((c) => c.marketing && !c.futureBooking && !busy.has(c.id))
    .filter((c) => segment.kind === "inactive_days" ? c.lastVisitDays === null || c.lastVisitDays >= segment.days : segment.kind === "credit_remaining" ? c.credits > 0 : true);
}
function wilson(k: number, n: number): [number, number] {
  if (n === 0) return [0, 0];
  const z2 = 3.8416, c = (k + z2 / 2) / (n + z2), w = (1.96 / (n + z2)) * Math.sqrt((k * (n - k)) / n + z2 / 4);
  return [Math.max(0, +(c - w).toFixed(4)), Math.min(1, +(c + w).toFixed(4))];
}
function arm(c: Campaign, which: "treatment" | "control") {
  const ms = (state().members.get(c.id) ?? []).filter((m) => m.arm === which);
  const k = ms.filter((m) => m.converted).length;
  return { n: ms.length, converted: k, rate: ms.length ? +(k / ms.length).toFixed(4) : null, ci: wilson(k, ms.length), revenue_cents: k * 6000,
    sent: 0, manual: ms.filter((m) => m.step === "manual").length, skipped: ms.filter((m) => m.step === "cancelled").length, pending: 0 };
}
function result(c: Campaign): Campaign["result"] {
  const t = arm(c, "treatment"), k = arm(c, "control");
  const design = c.control_pct > 0 ? "randomized_control" : "observational";
  let difference: Campaign["result"]["difference"] = null;
  let verdict: Campaign["result"]["verdict"];
  if (design === "observational") verdict = "observation_only";
  else if (t.n < 5 || k.n < 5) verdict = "inconclusive";
  else {
    const d = t.rate! - k.rate!;
    const lo = +(d - Math.hypot(t.rate! - t.ci[0], k.ci[1] - k.rate!)).toFixed(4);
    const hi = +(d + Math.hypot(t.ci[1] - t.rate!, k.rate! - k.ci[0])).toFixed(4);
    difference = { value: +d.toFixed(4), ci: [lo, hi] };
    verdict = lo > 0 || hi < 0 ? "difference_detected" : "no_difference_detected";
  }
  return { design, final: c.status !== "running", window: { starts_at: c.starts_at, ends_at: c.ends_at }, arms: { treatment: t, control: k }, difference, verdict };
}
const withResult = (c: Campaign): Campaign => clone({ ...c, result: result(c) });
const find = (cid: string) => state().campaigns.find((c) => c.id === cid) ?? fail("NOT_FOUND");

export function createDemoPort(): CampaignsPort {
  return {
    kind: "demo",
    async services() {
      return fixtureServices.filter((s) => s.tenant_id === FX.tenants.A).map((s) => ({ id: s.id, name: s.name }));
    },
    async preview(segment): Promise<Preview> {
      const list = eligible(segment);
      return { segment, audience_hash: hash(list.map((c) => c.id)), audience_count: list.length,
        customers: list.map((c) => ({ customer_id: c.id, name: c.name, last_visit_at: c.lastVisitDays === null ? null : new Date(state().clock - c.lastVisitDays * DAY).toISOString(), has_channel: false, credits_remaining: c.credits })) };
    },
    approve(raw, key) {
      return once(key, () => {
        const parsed = CampaignApproveInput.safeParse(raw);
        if (!parsed.success) fail("VALIDATION_ERROR", parsed.error.issues[0]?.path.join(".") ?? "input");
        const input = parsed.data;
        const list = eligible(input.segment);
        if (hash(list.map((c) => c.id)) !== input.audience_hash) fail("STALE_VERSION", "audience_hash");
        if (list.length === 0) fail("POLICY_REJECTED", "audience");
        const offer = input.offer;
        const svc = offer.kind === "discount_pct" && offer.service_id ? fixtureServices.find((s) => s.id === offer.service_id) : null;
        const unit = offer.kind === "discount_pct" ? Math.floor((svc?.base_price_cents ?? 6000) * offer.pct / 100) : 0;
        const offerText = offer.kind === "none" ? "um horário reservado para você" : offer.kind === "discount_pct" ? `${offer.pct}% de desconto${svc ? ` em ${svc.name}` : ""}` : "regra de preço vigente";
        let control = Math.ceil(list.length * input.control_pct / 100);
        if (input.control_pct > 0 && list.length >= 2 && control === 0) control = 1;
        let treat = Math.min(list.length - control, input.max_sends);
        if (input.spend_cap_cents !== null && unit > 0) treat = Math.min(treat, Math.floor(input.spend_cap_cents / unit));
        if (treat < 1) fail("POLICY_REJECTED", "spend_cap");
        const cid = id("c1000000");
        const now = ts();
        const c: Campaign = { id: cid, name: input.name, segment: input.segment, audience_count: list.length, control_pct: input.control_pct, control_count: control, treatment_count: treat,
          max_sends: input.max_sends, spend_cap_cents: input.spend_cap_cents, estimated_cost_cents: unit * treat, offer: input.offer, offer_text: offerText, window_days: input.window_days,
          status: "running", starts_at: now, ends_at: new Date(state().clock + input.window_days * DAY).toISOString(), closed_at: null, created_at: now, version: 1,
          result: { design: "observational", final: false, window: { starts_at: now, ends_at: now }, arms: { treatment: arm({ id: cid } as Campaign, "treatment"), control: arm({ id: cid } as Campaign, "control") }, difference: null, verdict: "observation_only" } };
        // Sorteio estável por campanha (como o servidor: ordem por hash de campanha + cliente).
        const order = [...list].sort((a, b) => hash([cid + a.id]).localeCompare(hash([cid + b.id])));
        state().members.set(cid, order.slice(0, control + treat).map((cu, i) => ({ customer_id: cu.id, arm: i < control ? "control" : "treatment", converted: false, step: i < control ? null : "manual" })));
        state().campaigns.unshift(c);
        return withResult(c);
      });
    },
    async list() {
      return state().campaigns.map(withResult);
    },
    async get(cid): Promise<CampaignDetail> {
      const c = find(cid);
      return { campaign: withResult(c), members: (state().members.get(cid) ?? []).map((m) => ({ customer_id: m.customer_id, customer_name: CUSTOMERS.find((x) => x.id === m.customer_id)?.name ?? "cliente", arm: m.arm, step_status: m.step, converted: m.converted })) };
    },
    cancel(input, key) {
      return once(key, () => {
        const c = find(input.id);
        if (c.version !== input.version) fail("STALE_VERSION");
        if (c.status !== "running") fail("POLICY_REJECTED", "status");
        for (const m of state().members.get(c.id) ?? []) if (m.step === "manual") m.step = "cancelled";
        Object.assign(c, { status: "cancelled", ends_at: ts(), closed_at: ts(), version: c.version + 1 });
        return withResult(c);
      });
    },
    async simulate(cid) {
      const c = find(cid);
      if (c.status !== "running") fail("POLICY_REJECTED", "status");
      // Medido, não declarado: na simulação, 3 de cada 4 tratadas e 1 de cada 4 do controle agendam na janela.
      (state().members.get(cid) ?? []).forEach((m, i) => { m.converted = m.arm === "treatment" ? i % 4 !== 0 : i % 4 === 0; });
      state().clock = Date.parse(c.ends_at) + 60_000;
      Object.assign(c, { status: "closed", closed_at: ts(), version: c.version + 1 });
      return withResult(c);
    },
  };
}
