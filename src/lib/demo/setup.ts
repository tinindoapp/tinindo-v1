// ESTADO ÚNICO da Configuração na DEMONSTRAÇÃO sem servidor (P50). Nada daqui roda no servidor nem persiste além da aba.
//
// Por que existe: a tela de Configuração (src/features/setup), o cartão da Home e o "Me ajuda a configurar" do
// Assistente (src/features/agent) precisam mostrar o MESMO progresso, e um módulo não importa o outro. Antes, o
// Assistente refazia a conta por conta própria e não via o passo dispensado nem o que o rascunho salvou (revisão de
// 04/11, achado A5). Agora os dois leem e gravam aqui.
//
// Por que nesta pasta: é a ponte da demonstração (integrador), que todo módulo pode importar. Veio de
// supabase/functions/_shared/domain/setup/demo.ts no recado #115.
//
// Ponte com o resto da demonstração (decisão D5: só o ciclo central): o que o dono confirma na Configuração
// (expediente, serviços, profissão) é publicado aqui. A Agenda, os Serviços e o perfil de exemplo passam a ler isto
// ligando um leitor com `readDemoSetup` (recado #115: Agenda em scheduling/fixturePort.ts, catálogo em crm/api.ts e
// perfil em network/demoApi.ts, todos ao carregar o módulo). Enquanto nenhum leitor de um tipo está ligado, `demoSetupReach`
// diz que a gravação não sai da tela de Configuração, e a tela avisa isso em vez de prometer que a Agenda mudou.
import type { Profession, SetupProgress, SetupServicesApplyOutput, SetupStep, SetupStepCode, WeeklyWindow } from "@contracts";
import { FIXED_NOW, tenantA } from "@contracts/fixtures.ts";

type CreatedService = SetupServicesApplyOutput["created"][number];

/** Catálogo dos passos (src/lib/setup/steps.ts), passado por quem chama para esta pasta não depender do front. */
export interface DemoStepSpec { step: SetupStepCode; required: boolean; title: string; why: string; link: string }

const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
const NOW = Date.parse(FIXED_NOW);
const CREATED_AT = NOW - 21 * DAY;

export interface DemoSetupState {
  profession: Profession;
  /** Data do fato que conclui cada passo; o perfil vem de fora (publicado na tela Perfil desta aba). */
  facts: Record<Exclude<SetupStepCode, "profile">, number | null>;
  services: CreatedService[];
  /** Expediente salvo pela Configuração nesta aba; null = o de exemplo da Agenda. */
  hours: WeeklyWindow[] | null;
  dismissed: Set<SetupStepCode>;
  completed: Map<SetupStepCode, number>;
  events: { step: SetupStepCode; seconds_since_signup: number }[];
  idem: Map<string, unknown>;
  seq: number;
}

let shared: DemoSetupState | null = null;

function seed(): DemoSetupState {
  // A Barbearia Exemplo A já tem expediente, serviços, política, cliente e recebimentos.
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

export const demoSetupState = (): DemoSetupState => shared ?? seed();
export const DEMO_SETUP_NOW = NOW;

/** Só para testes: volta ao estado inicial (os leitores ligados continuam ligados). */
export function resetDemoSetup(): void {
  shared = null;
}

/**
 * Progresso no formato do contrato, pelas mesmas regras do banco: feito é consequência do fato existir, obrigatórios
 * primeiro no próximo passo, e o evento do passo concluído sai uma vez.
 */
export function demoSetupProgress(catalog: readonly DemoStepSpec[], ctx: { profilePublished: boolean }): SetupProgress {
  const s = demoSetupState();
  const rows: SetupStep[] = catalog.map((spec) => {
    const at = spec.step === "profile" ? (ctx.profilePublished ? NOW : null) : s.facts[spec.step];
    if (at !== null && !s.completed.has(spec.step)) {
      s.completed.set(spec.step, at);
      s.events.push({ step: spec.step, seconds_since_signup: Math.max(0, Math.floor((at - CREATED_AT) / 1000)) });
    }
    const done = at !== null;
    return { step: spec.step, required: spec.required, title: spec.title, why: done ? null : spec.why, link: spec.link, done, done_at: done ? iso(at) : null, dismissed: !done && s.dismissed.has(spec.step) };
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

/** Dispensa (ou volta a mostrar) um passo opcional. false = passo obrigatório ou desconhecido: nada muda. */
export function demoSetupDismiss(catalog: readonly DemoStepSpec[], step: SetupStepCode, dismissed: boolean): boolean {
  const spec = catalog.find((x) => x.step === step);
  if (!spec || spec.required) return false;
  const s = demoSetupState();
  if (dismissed) s.dismissed.add(step);
  else s.dismissed.delete(step);
  return true;
}

// ---------------------------------------------------------------- ponte com a Agenda, os Serviços e o perfil

export interface DemoSetupChange {
  /** Expediente inteiro que substitui o da agenda principal. */
  hours: WeeklyWindow[];
  /** Serviços criados agora (entram no catálogo; os anteriores continuam). */
  services: CreatedService[];
  profession: Profession;
}
export type DemoSetupKind = keyof DemoSetupChange;

const readers: { [K in DemoSetupKind]: Set<(value: DemoSetupChange[K]) => void> } = { hours: new Set(), services: new Set(), profession: new Set() };

/**
 * Liga um leitor da demonstração (a Agenda para `hours`, o catálogo para `services`, o perfil para `profession`).
 * Devolve a função que desliga. O leitor recebe cada gravação confirmada na Configuração desta aba.
 */
export function readDemoSetup<K extends DemoSetupKind>(kind: K, reader: (value: DemoSetupChange[K]) => void): () => void {
  readers[kind].add(reader);
  return () => void readers[kind].delete(reader);
}

/** Há algum leitor ligado para este tipo? A tela usa isto para dizer a verdade sobre o alcance da gravação. */
export const demoSetupReach = (kind: DemoSetupKind): boolean => readers[kind].size > 0;

/** Publica uma gravação confirmada para os leitores ligados. Leitor que falha não derruba a Configuração. */
export function publishDemoSetup<K extends DemoSetupKind>(kind: K, value: DemoSetupChange[K]): void {
  for (const reader of readers[kind]) {
    try {
      reader(structuredClone(value));
    } catch {
      // A demonstração segue: a Configuração já guardou o próprio estado.
    }
  }
}
