// EMULAÇÃO do Relacionamento para a demonstração sem servidor. Mesmas regras do banco que a tela explica: passos
// nascem dos eventos (aqui, de uma agenda de exemplo), param por evento, um por (régua, agregado, chave); sem canal
// viram "para você compartilhar"; teto diário adia; opt-out e consentimento revogado pulam; reativação só como
// campanha aprovada com o público visto. Nada é enviado: o canal da demonstração é o do P12 (simulado).
import { DEFAULT_MESSAGES, ERROR_STATUS, type ErrorCode, type LifecycleCampaign, type LifecycleSettings, type LifecycleStep, type LifecycleStepStatus, RETRYABLE } from "@contracts";
import { FIXED_NOW, FX } from "@contracts/fixtures.ts";
import { ApiError } from "../../lib/api/client.ts";
import type { Audience, LifecyclePort, StepsList } from "./port.ts";

function fail(code: ErrorCode, field?: string): never {
  throw new ApiError(code, DEFAULT_MESSAGES[code], ERROR_STATUS[code], crypto.randomUUID(), RETRYABLE.has(code), field);
}
const clone = <T>(v: T): T => structuredClone(v);
export const DEMO_BUSINESS = "Barbearia do Léo (exemplo)";
const TZ = "America/Sao_Paulo";
const when = (iso: string) => new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)).replace(",", " às");

export const DEMO_CUSTOMERS = [
  { id: FX.customers.abInA, name: "Ana Beatriz (exemplo)", has_channel: true, last_visit_at: "2026-10-20T13:00:00Z" },
  { id: FX.customers.guestInA, name: "Carlos (exemplo)", has_channel: false, last_visit_at: "2026-07-10T14:00:00Z" },
  { id: "30000000-0000-4000-8000-0000000000a3", name: "Marina (exemplo)", has_channel: false, last_visit_at: null },
];

interface State {
  settings: LifecycleSettings;
  steps: LifecycleStep[];
  consents: Map<string, boolean>; // `${customer}:${purpose}` → granted (false = revogado)
  campaigns: LifecycleCampaign[];
  idem: Map<string, unknown>;
  seq: number;
  clock: number;
  sentToday: number;
}
let shared: State | null = null;
const ts = () => {
  const s = shared!;
  s.clock += 1000;
  return new Date(s.clock).toISOString();
};
const id = (p: string) => `${p}-0000-4000-8000-${String(++shared!.seq).padStart(12, "0")}`;
function state(): State {
  if (!shared) {
    shared = { settings: { enabled: true, confirmation: true, reminder_hours: [24, 2], quote_followup_days: 2, receivable_reminder: true, reactivation_days: 60, daily_budget: 30, version: 0 },
      steps: [], consents: new Map(), campaigns: [], idem: new Map(), seq: 0, clock: Date.parse(FIXED_NOW), sentToday: 0 };
    // Agenda de exemplo: um atendimento da Ana amanhã à tarde (confirmação já enviada ao canal, lembretes agendados),
    // um do Carlos depois de amanhã (sem canal: confirmação para compartilhar), um orçamento parado há 3 dias.
    const ana = Date.parse(FIXED_NOW) + 30 * 3_600_000; // amanhã às 15h: o lembrete de 24 h ainda não venceu
    const carlos = Date.parse(FIXED_NOW) + 46 * 3_600_000;
    const b1 = id("f1000000"), b2 = id("f1000000"), q1 = id("f2000000");
    const step = (over: Partial<LifecycleStep> & Pick<LifecycleStep, "rule" | "step_key" | "aggregate_type" | "aggregate_id" | "customer_id" | "due_at" | "status" | "template_code" | "body">): LifecycleStep =>
      ({ id: id("f3000000"), customer_name: DEMO_CUSTOMERS.find((c) => c.id === over.customer_id)?.name ?? null, campaign_id: null, skip_reason: null, channel_message_id: null,
        message_status: null, resolved_at: null, created_at: ts(), version: 1, ...over });
    shared.steps.push(
      step({ rule: "confirmation", step_key: "v1", aggregate_type: "booking", aggregate_id: b1, customer_id: FX.customers.abInA, due_at: ts(), status: "sent", template_code: "confirmacao_agendamento",
        body: `Olá, Ana Beatriz (exemplo)! Seu horário de Corte está confirmado para ${when(new Date(ana).toISOString())}. Responda SAIR para não receber mais avisos.`, message_status: "delivered", resolved_at: ts() }),
      step({ rule: "reminder", step_key: "v1-h24", aggregate_type: "booking", aggregate_id: b1, customer_id: FX.customers.abInA, due_at: new Date(ana - 24 * 3_600_000).toISOString(), status: "scheduled",
        template_code: "lembrete_agendamento", body: `Lembrete: Corte em ${when(new Date(ana).toISOString())}. Se precisar remarcar, responda esta mensagem.` }),
      step({ rule: "reminder", step_key: "v1-h2", aggregate_type: "booking", aggregate_id: b1, customer_id: FX.customers.abInA, due_at: new Date(ana - 2 * 3_600_000).toISOString(), status: "scheduled",
        template_code: "lembrete_agendamento", body: `Lembrete: Corte em ${when(new Date(ana).toISOString())}. Se precisar remarcar, responda esta mensagem.` }),
      step({ rule: "confirmation", step_key: "v1", aggregate_type: "booking", aggregate_id: b2, customer_id: FX.customers.guestInA, due_at: ts(), status: "manual", template_code: "confirmacao_agendamento",
        body: `Olá, Carlos (exemplo)! Seu horário de Barba está confirmado para ${when(new Date(carlos).toISOString())}. Responda SAIR para não receber mais avisos.`, resolved_at: ts() }),
      step({ rule: "quote_followup", step_key: "d2", aggregate_type: "quote", aggregate_id: q1, customer_id: FX.customers.guestInA, due_at: ts(), status: "manual", template_code: "lembrete_orcamento",
        body: "Olá, Carlos (exemplo)! Seu orçamento de R$ 100,00 continua disponível até 27/10 às 23:59. Se tiver dúvida, responda esta mensagem.", resolved_at: ts() }),
    );
    shared.sentToday = 1;
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
const find = (stepId: string) => state().steps.find((x) => x.id === stepId) ?? fail("NOT_FOUND");
const hash = (ids: string[]) => {
  // Hash determinístico simples (não criptográfico) só para a demonstração reconhecer o público visto.
  let h = 0;
  for (const ch of ids.sort().join(",")) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h.toString(16).padStart(8, "0").repeat(8);
};
function audience(): Audience {
  const s = state();
  const cutoff = s.clock - s.settings.reactivation_days * 86_400_000;
  const customers = DEMO_CUSTOMERS.filter((c) => s.consents.get(`${c.id}:marketing`) === true
    && (c.last_visit_at === null || Date.parse(c.last_visit_at) < cutoff)
    && !s.steps.some((x) => x.rule === "reactivation" && x.customer_id === c.id))
    .map((c) => ({ customer_id: c.id, name: c.name, last_visit_at: c.last_visit_at, has_channel: c.has_channel }));
  return { customers, audience_hash: hash(customers.map((c) => c.customer_id)), reactivation_days: s.settings.reactivation_days, daily_budget: s.settings.daily_budget, sent_today: s.sentToday };
}
function dispatch(x: LifecycleStep): LifecycleStepStatus {
  const s = state();
  const c = DEMO_CUSTOMERS.find((d) => d.id === x.customer_id);
  const purpose = x.rule === "reactivation" ? "marketing" : "transactional";
  const consent = s.consents.get(`${x.customer_id}:${purpose}`);
  if (purpose === "marketing" ? consent !== true : consent === false) {
    Object.assign(x, { status: "skipped", skip_reason: purpose === "marketing" ? "no_marketing_consent" : "consent_revoked", resolved_at: ts() });
    return "skipped";
  }
  if (!c?.has_channel) {
    Object.assign(x, { status: "manual", resolved_at: ts() });
    return "manual";
  }
  if (s.sentToday >= s.settings.daily_budget) {
    Object.assign(x, { status: "deferred", skip_reason: "daily_budget", due_at: new Date(s.clock + 86_400_000).toISOString() });
    return "deferred";
  }
  s.sentToday += 1;
  Object.assign(x, { status: "sent", channel_message_id: id("f4000000"), message_status: "queued", resolved_at: ts(), skip_reason: null });
  return "sent";
}

export function createDemoPort(): LifecyclePort {
  return {
    kind: "demo",
    async settings() {
      return clone({ settings: state().settings, sent_today: state().sentToday });
    },
    saveSettings(patch, expectedVersion, key) {
      return once(key, () => {
        const s = state();
        if (s.settings.version !== expectedVersion) fail("STALE_VERSION");
        const next = { ...s.settings, ...patch, version: s.settings.version + 1 };
        if (next.reminder_hours.some((h) => ![1, 2, 3, 6, 12, 24, 48].includes(h)) || next.daily_budget < 0 || next.daily_budget > 500) fail("VALIDATION_ERROR", "settings");
        s.settings = next;
        return clone({ settings: s.settings, sent_today: s.sentToday });
      });
    },
    async steps(status): Promise<StepsList> {
      const s = state();
      const steps = [...s.steps].sort((a, b) => b.due_at.localeCompare(a.due_at)).filter((x) => !status || x.status === status);
      const counts: Record<string, number> = {};
      for (const x of s.steps) counts[x.status] = (counts[x.status] ?? 0) + 1;
      return clone({ steps, counts });
    },
    markShared(stepId, key) {
      return once(key, () => {
        const x = find(stepId);
        if (x.status !== "manual") fail("POLICY_REJECTED", "status");
        Object.assign(x, { status: "shared", resolved_at: ts() });
        x.version += 1;
        return clone(x);
      });
    },
    cancelStep(stepId, key) {
      return once(key, () => {
        const x = find(stepId);
        if (!["scheduled", "deferred", "manual"].includes(x.status)) fail("POLICY_REJECTED", "status");
        Object.assign(x, { status: "cancelled", skip_reason: "owner", resolved_at: ts() });
        x.version += 1;
        return clone(x);
      });
    },
    setConsent(customerId, purpose, granted, key) {
      return once(key, () => {
        const s = state();
        if (!DEMO_CUSTOMERS.some((c) => c.id === customerId)) fail("NOT_FOUND", "customer_id");
        s.consents.set(`${customerId}:${purpose}`, granted);
        if (!granted) {
          for (const x of s.steps) {
            if (x.customer_id === customerId && ["scheduled", "deferred", "manual"].includes(x.status) && (purpose === "marketing") === (x.rule === "reactivation")) {
              Object.assign(x, { status: "cancelled", skip_reason: "consent_revoked", resolved_at: ts() });
            }
          }
        }
        return granted;
      });
    },
    async audience() {
      return audience();
    },
    approveCampaign(audienceHash, maxSends, key) {
      return once(key, () => {
        const s = state();
        const a = audience();
        if (a.audience_hash !== audienceHash) fail("STALE_VERSION", "audience_hash");
        if (a.customers.length === 0) fail("POLICY_REJECTED", "audience");
        const c: LifecycleCampaign = { id: id("f5000000"), kind: "reactivation", audience_count: a.customers.length, max_sends: maxSends, status: "approved", created_at: ts(), scheduled: 0, sent: 0, skipped: 0 };
        for (const cu of a.customers.slice(0, maxSends)) {
          s.steps.push({ id: id("f3000000"), rule: "reactivation", step_key: `c${c.id.slice(-8)}`, aggregate_type: "customer", aggregate_id: cu.customer_id, customer_id: cu.customer_id,
            customer_name: cu.name, campaign_id: c.id, due_at: ts(), status: "scheduled", skip_reason: null, template_code: "reativacao",
            body: `Olá, ${cu.name}! Faz tempo que não nos vemos no ${DEMO_BUSINESS}. Quer agendar um horário? Responda SAIR para não receber mais convites.`,
            channel_message_id: null, message_status: null, resolved_at: null, created_at: ts(), version: 1 });
          c.scheduled = (c.scheduled ?? 0) + 1;
        }
        s.campaigns.unshift(c);
        return clone(c);
      });
    },
    async campaigns() {
      const s = state();
      return clone(s.campaigns.map((c) => ({ ...c,
        sent: s.steps.filter((x) => x.campaign_id === c.id && (x.status === "sent" || x.status === "shared")).length,
        skipped: s.steps.filter((x) => x.campaign_id === c.id && (x.status === "skipped" || x.status === "cancelled")).length })));
    },
    async tick() {
      const s = state();
      const r: Record<"sent" | "manual" | "skipped" | "deferred" | "cancelled" | "created", number> = { sent: 0, manual: 0, skipped: 0, deferred: 0, cancelled: 0, created: 0 };
      for (const x of s.steps) {
        if ((x.status === "scheduled" || x.status === "deferred") && Date.parse(x.due_at) <= s.clock) {
          const out = dispatch(x);
          if (out in r) r[out as keyof typeof r] += 1;
        }
      }
      return r;
    },
  };
}

/** Só para testes e para a demonstração: avança o relógio (vence lembretes). */
export function advanceDemoClock(ms: number) {
  state().clock += ms;
}
