// "Me ajuda a configurar" (P46) conduz pelos passos do P44, um por vez, a partir de `setup.progress`.
//
// A resposta é a do contrato oficial (`SetupProgressOutput` de @contracts), a mesma que a tela de Configuração lê. O
// rótulo, a tela e o verbo do botão de cada passo vêm do catálogo comum (src/lib/setup/steps.ts). Cada confirmação
// grava pela tela normal do link (operações de sempre); o guia só grava o "Pular", por `setup.dismiss`.
//
// P50: na demonstração o progresso vem do MESMO estado da tela de Configuração e do cartão da Home
// (src/lib/demo/setup.ts): o que foi dispensado ou salvo lá aparece aqui, e vice-versa.
import type { SetupProgress, SetupStep, SetupStepCode } from "@contracts";
import { demoSetupDismiss, demoSetupProgress as sharedDemoProgress } from "../../lib/demo/setup.ts";
import { getPublishedSlug } from "../../lib/demo/journey.ts";
import { SETUP_STEPS, type SetupStepSpec, setupStepSpec } from "../../lib/setup/steps.ts";

export type { SetupProgress, SetupStep };

/** Próximo passo a mostrar: obrigatórios primeiro, o primeiro não feito, não dispensado e não pulado agora. */
export function nextStep(p: SetupProgress, skipped: ReadonlySet<SetupStepCode>): SetupStep | null {
  const ordered = [...p.steps].sort((a, b) => Number(!a.required) - Number(!b.required));
  return ordered.find((s) => !s.done && !s.dismissed && !skipped.has(s.step)) ?? null;
}

/**
 * P50: o porquê da antecedência para cancelar diz o que o dono define e onde o cliente vê (o texto antigo prometia o
 * que o link público não mostrava; revisão de 04/11, achado A3). Mesmo texto da tela de Configuração
 * (src/features/setup/labels.ts). Desde o recado #115 o catálogo comum e app.setup_steps() já têm este texto; a
 * sobreposição fica até a migration valer em todo banco lido.
 */
const CANCELLATION_WHY = "Você define até quantas horas antes o cliente cancela sem custo. É a regra que o link público mostra a quem vai reservar.";

/** Apresentação do passo (rótulo, porquê, tela, verbo do botão), do catálogo comum. */
export const stepSpec = (step: SetupStepCode): SetupStepSpec => {
  const spec = setupStepSpec(step);
  return step === "cancellation_policy" ? { ...spec, why: CANCELLATION_WHY } : spec;
};

/** Progresso da demonstração no formato do contrato: o mesmo estado que a Configuração e a Home mostram. */
export function demoSetupProgress(): SetupProgress {
  return structuredClone(sharedDemoProgress(SETUP_STEPS, { profilePublished: getPublishedSlug() !== null }));
}

/** "Pular" na demonstração: dispensa o passo opcional no mesmo estado da Configuração. null = passo obrigatório. */
export function demoSetupSkip(step: SetupStepCode): SetupProgress | null {
  return demoSetupDismiss(SETUP_STEPS, step, true) ? demoSetupProgress() : null;
}
