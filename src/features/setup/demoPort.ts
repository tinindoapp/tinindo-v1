// EMULAÇÃO da Configuração para a demonstração sem servidor. Mesmas regras do banco que a tela explica: o estado de
// cada passo vem de um fato (aqui, os dados de exemplo da aba: a Barbearia Exemplo A já tem expediente, serviços,
// política, cliente e recebimentos; o perfil só fica "feito" quando o dono o publica na tela Perfil desta aba);
// passo obrigatório não se dispensa; nada é criado sem a confirmação; o evento do passo sai uma vez. Nada persiste.
import { DEFAULT_MESSAGES, ERROR_STATUS, type ErrorCode, type Profession, RETRYABLE, type SetupDescribeDraft, type WeeklyWindow } from "@contracts";
import { FIXED_NOW, tenantA } from "@contracts/fixtures.ts";
import { ApiError } from "../../lib/api/client.ts";
import { getPublishedSlug } from "../../lib/demo/journey.ts";
import { STEP_CATALOG } from "./labels.ts";
import type { CreatedService, SetupPort, SetupProgress, SetupServiceDraft, SetupStepCode, SetupTemplate, SetupTemplatesOutput } from "./port.ts";

function fail(code: ErrorCode, field?: string): never {
  throw new ApiError(code, DEFAULT_MESSAGES[code], ERROR_STATUS[code], crypto.randomUUID(), RETRYABLE.has(code), field);
}
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
const NOW = Date.parse(FIXED_NOW);
const CREATED_AT = NOW - 21 * DAY;
const clone = <T>(v: T): T => structuredClone(v);

type Seed = Omit<SetupTemplate, "exists"> & { profession: Profession };
/** Os mesmos modelos da migration (só por migration; aqui a cópia de exemplo). */
const TEMPLATES: readonly Seed[] = [
  { code: "barber_corte", profession: "barber", kind: "service", name: "Corte", duration_min: 30, buffer_before_min: 0, buffer_after_min: 10, price_from_cents: 3500, price_to_cents: 7000 },
  { code: "barber_barba", profession: "barber", kind: "service", name: "Barba", duration_min: 20, buffer_before_min: 0, buffer_after_min: 5, price_from_cents: 2500, price_to_cents: 5000 },
  { code: "barber_corte_barba", profession: "barber", kind: "service", name: "Corte e barba", duration_min: 50, buffer_before_min: 0, buffer_after_min: 10, price_from_cents: 5500, price_to_cents: 11000 },
  { code: "hair_corte", profession: "hairdresser", kind: "service", name: "Corte", duration_min: 45, buffer_before_min: 0, buffer_after_min: 10, price_from_cents: 5000, price_to_cents: 15000 },
  { code: "hair_escova", profession: "hairdresser", kind: "service", name: "Escova", duration_min: 40, buffer_before_min: 0, buffer_after_min: 10, price_from_cents: 4000, price_to_cents: 10000 },
  { code: "hair_coloracao", profession: "hairdresser", kind: "service", name: "Coloração", duration_min: 120, buffer_before_min: 0, buffer_after_min: 15, price_from_cents: 12000, price_to_cents: 35000 },
  { code: "hair_hidratacao", profession: "hairdresser", kind: "service", name: "Hidratação", duration_min: 45, buffer_before_min: 0, buffer_after_min: 10, price_from_cents: 5000, price_to_cents: 15000 },
  { code: "pt_avaliacao", profession: "personal_trainer", kind: "service", name: "Avaliação física", duration_min: 45, buffer_before_min: 15, buffer_after_min: 15, price_from_cents: 8000, price_to_cents: 20000 },
  { code: "pt_sessao", profession: "personal_trainer", kind: "service", name: "Sessão individual", duration_min: 60, buffer_before_min: 15, buffer_after_min: 15, price_from_cents: 8000, price_to_cents: 20000 },
  { code: "pt_pacote_10", profession: "personal_trainer", kind: "package", name: "Pacote de 10 sessões", duration_min: 60, buffer_before_min: 15, buffer_after_min: 15, price_from_cents: 70000, price_to_cents: 180000 },
  { code: "other_atendimento", profession: "other", kind: "service", name: "Atendimento", duration_min: 60, buffer_before_min: 0, buffer_after_min: 10, price_from_cents: null, price_to_cents: null },
];

interface State {
  profession: Profession;
  facts: Record<Exclude<SetupStepCode, "profile">, number | null>;
  services: CreatedService[];
  hours: WeeklyWindow[] | null;
  dismissed: Set<SetupStepCode>;
  completed: Map<SetupStepCode, number>;
  events: { step: SetupStepCode; seconds_since_signup: number }[];
  idem: Map<string, unknown>;
  seq: number;
}
let shared: State | null = null;
function seed(): State {
  shared = {
    profession: tenantA.profession,
    facts: { hours: CREATED_AT + 2 * DAY, service: CREATED_AT + 2 * DAY, cancellation_policy: CREATED_AT + 3 * DAY, first_customer: CREATED_AT + 4 * DAY, photo_whatsapp: null, channel: null, first_cash: CREATED_AT + 6 * DAY },
    services: [
      { id: "40000000-0000-4000-8000-0000000000a1", template_code: null, name: "Corte", duration_min: 30, base_price_cents: 6000 },
      { id: "40000000-0000-4000-8000-0000000000a2", template_code: null, name: "Barba", duration_min: 20, base_price_cents: 4000 },
    ],
    hours: null, dismissed: new Set(), completed: new Map(), events: [], idem: new Map(), seq: 0,
  };
  return shared;
}
const state = () => shared ?? seed();
/** Só para testes: volta ao estado inicial. */
export function resetDemoState() {
  shared = null;
}
/** Só para testes: eventos `setup.step_completed.v1` emitidos pela emulação. */
export function demoSetupEvents() {
  return clone(state().events);
}
const normalizeName = (n: string) => n.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

function doneAt(s: State, step: SetupStepCode): number | null {
  if (step === "profile") return getPublishedSlug() ? NOW : null;
  return s.facts[step];
}

function progress(): SetupProgress {
  const s = state();
  const rows = STEP_CATALOG.map((spec) => {
    const at = doneAt(s, spec.step);
    if (at !== null && !s.completed.has(spec.step)) {
      s.completed.set(spec.step, at);
      s.events.push({ step: spec.step, seconds_since_signup: Math.max(0, Math.floor((at - CREATED_AT) / 1000)) });
    }
    const done = at !== null;
    const dismissed = !done && s.dismissed.has(spec.step);
    return { step: spec.step, required: spec.required, title: spec.title, why: done ? null : spec.why, link: spec.link, done, done_at: done ? iso(at) : null, dismissed };
  });
  const required = rows.filter((r) => r.required);
  const ready = required.every((r) => r.done);
  const readyAt = ready ? Math.max(...required.map((r) => Date.parse(r.done_at!))) : null;
  const next = [...rows].sort((a, b) => Number(!a.required) - Number(!b.required)).find((r) => !r.done && !r.dismissed)?.step ?? null;
  return {
    business_name: tenantA.name, profession: s.profession, created_at: iso(CREATED_AT),
    steps: rows, done_count: rows.filter((r) => r.done).length, resolved_count: rows.filter((r) => r.done || r.dismissed).length, total: 8,
    next, ready, ready_at: readyAt === null ? null : iso(readyAt), ready_in_24h: readyAt !== null && readyAt <= CREATED_AT + DAY,
  };
}

function templates(): SetupTemplatesOutput {
  const s = state();
  const names = new Set(s.services.map((x) => normalizeName(x.name)));
  return { profession: s.profession, templates: TEMPLATES.filter((t) => t.profession === s.profession).map(({ profession: _p, ...t }) => ({ ...t, exists: names.has(normalizeName(t.name)) })) };
}

function applyServices(services: SetupServiceDraft[]): CreatedService[] {
  const s = state();
  if (services.length < 1 || services.length > 20) fail("VALIDATION_ERROR", "services");
  const created: CreatedService[] = [];
  const seen = new Set(s.services.map((x) => normalizeName(x.name)));
  for (const d of services) {
    const name = d.name.trim();
    if (!name || name.length > 120) fail("VALIDATION_ERROR", "name");
    if (!Number.isInteger(d.duration_min) || d.duration_min < 5 || d.duration_min > 1440) fail("VALIDATION_ERROR", "duration_min");
    if (!Number.isInteger(d.base_price_cents) || d.base_price_cents < 0) fail("VALIDATION_ERROR", "base_price_cents");
    if (d.template_code && !TEMPLATES.some((t) => t.code === d.template_code && t.kind === "service")) fail("VALIDATION_ERROR", "template_code");
    if (seen.has(normalizeName(name))) fail("VALIDATION_ERROR", "name");
    seen.add(normalizeName(name));
    created.push({ id: `d4000000-0000-4000-8000-${String(++s.seq).padStart(12, "0")}`, template_code: d.template_code ?? null, name, duration_min: d.duration_min, base_price_cents: d.base_price_cents });
  }
  // Tudo ou nada: só grava depois de validar todos.
  s.services.push(...created);
  if (s.facts.service === null) s.facts.service = NOW;
  return clone(created);
}

function idempotent<T>(key: string, run: () => T): T {
  const s = state();
  if (s.idem.has(key)) return clone(s.idem.get(key) as T);
  const out = run();
  s.idem.set(key, clone(out));
  return out;
}

export function createDemoPort(): SetupPort {
  return {
    kind: "demo",
    async progress() {
      return clone(progress());
    },
    async dismiss(step, dismissed, key) {
      return idempotent(key, () => {
        const s = state();
        const spec = STEP_CATALOG.find((x) => x.step === step);
        if (!spec || spec.required) fail("VALIDATION_ERROR", "step");
        if (dismissed) s.dismissed.add(step);
        else s.dismissed.delete(step);
        return progress();
      });
    },
    async templates() {
      return clone(templates());
    },
    async applyServices(services, key) {
      return idempotent(key, () => ({ created: applyServices(services), progress: progress() }));
    },
    async applyDraft(input, key) {
      return idempotent(key, () => {
        const s = state();
        const services = input.services ?? [];
        if (input.profession == null && input.hours == null && services.length === 0) fail("VALIDATION_ERROR", "hours");
        if (input.profession) s.profession = input.profession;
        let hours: WeeklyWindow[] | null = null;
        if (input.hours) {
          for (const h of input.hours) if (h.local_end <= h.local_start) fail("VALIDATION_ERROR", "hours");
          hours = input.hours.map((h) => ({ ...h }));
          s.hours = hours;
          if (s.facts.hours === null) s.facts.hours = NOW;
        }
        const created = services.length ? applyServices(services.map((d) => ({ template_code: d.template_code ?? null, name: d.name, duration_min: d.duration_min, base_price_cents: d.base_price_cents }))) : [];
        return { profession: s.profession, hours, created, progress: progress() };
      });
    },
  };
}

/** Rascunho de exemplo (para a tela mostrar o formato sem digitar): a frase do docs/12. */
export const DEMO_SENTENCE = "Sou barbeiro, sozinho, de terça a sábado das 9 às 19";
export type { SetupDescribeDraft };
