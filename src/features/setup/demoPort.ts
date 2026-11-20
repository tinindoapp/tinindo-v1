// EMULAÇÃO da Configuração para a demonstração sem servidor. Mesmas regras do banco que a tela explica: o estado de
// cada passo vem de um fato (os dados de exemplo da aba: a Barbearia Exemplo A já tem expediente, serviços, política,
// cliente e recebimentos; o perfil só fica "feito" quando o dono o publica na tela Perfil desta aba); passo obrigatório
// não se dispensa; nada é criado sem a confirmação; o evento do passo sai uma vez. Nada persiste.
//
// P50: o estado mora em src/lib/demo/setup.ts, o mesmo que o "Me ajuda a configurar" do
// Assistente lê (progresso igual nas duas telas). O que o dono confirma aqui (expediente, serviços, profissão) é
// publicado para a Agenda, os Serviços e o perfil de exemplo por `publishDemoSetup`; `reach` diz se há leitor ligado.
import { DEFAULT_MESSAGES, ERROR_STATUS, type ErrorCode, RETRYABLE, type WeeklyWindow } from "@contracts";
import {
  DEMO_SETUP_NOW, demoSetupDismiss, demoSetupProgress, demoSetupReach, demoSetupState, publishDemoSetup, resetDemoSetup,
} from "../../lib/demo/setup.ts";
import { describeBusiness } from "../../../supabase/functions/_shared/domain/setup/describe.ts";
import { SERVICE_TEMPLATES, templateKey } from "../../../supabase/functions/_shared/domain/setup/templates.ts";
import { ApiError } from "../../lib/api/client.ts";
import { getPublishedSlug } from "../../lib/demo/journey.ts";
import { STEP_CATALOG } from "./labels.ts";
import type { CreatedService, SetupPort, SetupProgress, SetupServiceDraft, SetupTemplatesOutput } from "./port.ts";

function fail(code: ErrorCode, field?: string): never {
  throw new ApiError(code, DEFAULT_MESSAGES[code], ERROR_STATUS[code], crypto.randomUUID(), RETRYABLE.has(code), field);
}
const clone = <T>(v: T): T => structuredClone(v);
const state = demoSetupState;

/** Só para testes: volta ao estado inicial. */
export function resetDemoState() {
  resetDemoSetup();
}
/** Só para testes: eventos `setup.step_completed.v1` emitidos pela emulação. */
export function demoSetupEvents() {
  return clone(state().events);
}

const progress = (): SetupProgress => demoSetupProgress(STEP_CATALOG, { profilePublished: getPublishedSlug() !== null });

function templates(): SetupTemplatesOutput {
  const s = state();
  const names = new Set(s.services.map((x) => templateKey(x.name)));
  return { profession: s.profession, templates: SERVICE_TEMPLATES.filter((t) => t.profession === s.profession).map(({ profession: _p, ...t }) => ({ ...t, exists: names.has(templateKey(t.name)) })) };
}

/** Valida todos os serviços sem gravar (tudo ou nada). */
function checkServices(services: SetupServiceDraft[]): CreatedService[] {
  const s = state();
  if (services.length < 1 || services.length > 20) fail("VALIDATION_ERROR", "services");
  const created: CreatedService[] = [];
  const seen = new Set(s.services.map((x) => templateKey(x.name)));
  let seq = s.seq;
  for (const d of services) {
    const name = d.name.trim();
    if (!name || name.length > 120) fail("VALIDATION_ERROR", "name");
    if (!Number.isInteger(d.duration_min) || d.duration_min < 5 || d.duration_min > 1440) fail("VALIDATION_ERROR", "duration_min");
    if (!Number.isInteger(d.base_price_cents) || d.base_price_cents < 0) fail("VALIDATION_ERROR", "base_price_cents");
    if (d.template_code && !SERVICE_TEMPLATES.some((t) => t.code === d.template_code && t.kind === "service")) fail("VALIDATION_ERROR", "template_code");
    if (seen.has(templateKey(name))) fail("VALIDATION_ERROR", "name");
    seen.add(templateKey(name));
    created.push({ id: `d4000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`, template_code: d.template_code ?? null, name, duration_min: d.duration_min, base_price_cents: d.base_price_cents });
  }
  return created;
}

function commitServices(created: CreatedService[]): void {
  const s = state();
  s.seq += created.length;
  s.services.push(...created);
  if (s.facts.service === null) s.facts.service = DEMO_SETUP_NOW;
  publishDemoSetup("services", created);
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
    get reach() {
      return { hours: demoSetupReach("hours"), services: demoSetupReach("services") };
    },
    async progress() {
      return clone(progress());
    },
    async dismiss(step, dismissed, key) {
      return idempotent(key, () => {
        if (!demoSetupDismiss(STEP_CATALOG, step, dismissed)) fail("VALIDATION_ERROR", "step");
        return progress();
      });
    },
    async templates() {
      return clone(templates());
    },
    // A demonstração não tem modelo de linguagem: as mesmas regras do servidor, na aba.
    async describe(sentence) {
      return { ...describeBusiness(sentence), assistant: false };
    },
    async applyServices(services, key) {
      return idempotent(key, () => {
        const created = checkServices(services);
        commitServices(created);
        return { created: clone(created), progress: progress() };
      });
    },
    async applyDraft(input, key) {
      return idempotent(key, () => {
        const s = state();
        const services = input.services ?? [];
        if (input.profession == null && input.hours == null && services.length === 0) fail("VALIDATION_ERROR", "hours");
        // Tudo ou nada, como no banco: valida expediente e serviços antes de gravar qualquer coisa (profissão incluída).
        let hours: WeeklyWindow[] | null = null;
        if (input.hours) {
          const sorted = [...input.hours].sort((a, b) => a.weekday - b.weekday || a.local_start.localeCompare(b.local_start));
          sorted.forEach((h, i) => {
            const prev = sorted[i - 1];
            if (h.local_end <= h.local_start || (prev && prev.weekday === h.weekday && prev.local_end > h.local_start)) fail("VALIDATION_ERROR", "hours");
          });
          hours = sorted.map((h) => ({ ...h }));
        }
        const created = services.length ? checkServices(services.map((d) => ({ template_code: d.template_code ?? null, name: d.name, duration_min: d.duration_min, base_price_cents: d.base_price_cents }))) : [];
        if (input.profession && input.profession !== s.profession) {
          s.profession = input.profession;
          publishDemoSetup("profession", input.profession);
        }
        if (hours) {
          s.hours = hours;
          if (s.facts.hours === null) s.facts.hours = DEMO_SETUP_NOW;
          publishDemoSetup("hours", hours);
        }
        if (created.length) commitServices(created);
        return { profession: s.profession, hours, created: clone(created), progress: progress() };
      });
    },
  };
}

/** Rascunho de exemplo (para a tela mostrar o formato sem digitar): a frase do docs/12. */
export const DEMO_SENTENCE = "Sou barbeiro, sozinho, de terça a sábado das 9 às 19";
