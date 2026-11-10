// "Me ajuda a configurar" (P46) conduz pelos passos do P44, um por vez, a partir de `setup.progress`.
//
// A resposta é a do contrato oficial (`SetupProgressOutput` de @contracts), a mesma que a tela de Configuração lê. O
// rótulo, o porquê, a tela e o verbo do botão de cada passo vêm do catálogo comum (src/lib/setup/steps.ts), o mesmo
// da tela de Configuração. Cada confirmação grava pela tela normal do link (operações de sempre); o guia não grava nada.
import { FIXED_NOW, tenantA } from "@contracts/fixtures.ts";
import type { SetupProgress, SetupStep, SetupStepCode } from "@contracts";
import { getPublishedSlug } from "../../lib/demo/journey.ts";
import { SETUP_STEPS, type SetupStepSpec, setupStepSpec } from "../../lib/setup/steps.ts";

export type { SetupProgress, SetupStep };

/** Próximo passo a mostrar: obrigatórios primeiro, o primeiro não feito, não dispensado e não pulado agora. */
export function nextStep(p: SetupProgress, skipped: ReadonlySet<SetupStepCode>): SetupStep | null {
  const ordered = [...p.steps].sort((a, b) => Number(!a.required) - Number(!b.required));
  return ordered.find((s) => !s.done && !s.dismissed && !skipped.has(s.step)) ?? null;
}

/** Apresentação do passo (rótulo, porquê, tela, verbo do botão), sempre do catálogo comum. */
export const stepSpec = (step: SetupStepCode): SetupStepSpec => setupStepSpec(step);

const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

/**
 * Progresso da demonstração no formato do contrato, com os mesmos fatos da emulação da tela de Configuração
 * (src/features/setup/demoPort.ts): a Barbearia Exemplo A já tem expediente, serviço, política, cliente e recebimento;
 * o perfil só conta como feito depois de publicado na tela Perfil desta aba.
 */
export function demoSetupProgress(): SetupProgress {
  const now = Date.parse(FIXED_NOW);
  const created = now - 21 * DAY;
  const facts: Record<SetupStepCode, number | null> = {
    hours: created + 2 * DAY, service: created + 2 * DAY, cancellation_policy: created + 3 * DAY,
    profile: getPublishedSlug() ? now : null, first_customer: created + 4 * DAY,
    photo_whatsapp: null, channel: null, first_cash: created + 6 * DAY,
  };
  const steps: SetupStep[] = SETUP_STEPS.map((spec) => {
    const at = facts[spec.step];
    const done = at !== null;
    return { step: spec.step, required: spec.required, title: spec.title, why: done ? null : spec.why, link: spec.link, done, done_at: done ? iso(at) : null, dismissed: false };
  });
  const required = steps.filter((s) => s.required);
  const ready = required.every((s) => s.done);
  const readyAt = ready ? Math.max(...required.map((s) => Date.parse(s.done_at!))) : null;
  const done = steps.filter((s) => s.done).length;
  return {
    business_name: tenantA.name, profession: tenantA.profession, created_at: iso(created),
    steps, done_count: done, resolved_count: done, total: 8,
    next: nextStep({ steps } as SetupProgress, new Set())?.step ?? null,
    ready, ready_at: readyAt === null ? null : iso(readyAt), ready_in_24h: readyAt !== null && readyAt <= created + DAY,
  };
}
