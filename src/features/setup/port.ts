// Portas do módulo Configuração (P44). Demonstração: emulação na aba, sempre rotulada; servidor: Edge Function `setup`.
import type {
  SetupDescribeDraft,
  SetupDraftApplyInput,
  SetupDraftApplyOutput,
  SetupProgress,
  SetupServiceDraft,
  SetupServicesApplyOutput,
  SetupStep,
  SetupStepCode,
  SetupTemplatesOutput,
} from "@contracts";
import type { z } from "zod";

export type DraftInput = z.input<typeof SetupDraftApplyInput>;
export type { SetupDescribeDraft, SetupProgress, SetupServiceDraft, SetupStep, SetupStepCode, SetupTemplatesOutput };
export type SetupTemplate = SetupTemplatesOutput["templates"][number];
export type CreatedService = SetupServicesApplyOutput["created"][number];

export interface SetupPort {
  readonly kind: "demo" | "server";
  /** Estado calculado pelos dados reais (grava a medição da primeira conclusão de cada passo). */
  progress(): Promise<SetupProgress>;
  dismiss(step: SetupStepCode, dismissed: boolean, key: string): Promise<SetupProgress>;
  templates(): Promise<SetupTemplatesOutput>;
  /** Cria os serviços confirmados pelo dono, tudo ou nada. */
  applyServices(services: SetupServiceDraft[], key: string): Promise<SetupServicesApplyOutput>;
  /** Aplica o rascunho revisado (profissão, expediente, serviços), tudo ou nada. */
  applyDraft(input: DraftInput, key: string): Promise<SetupDraftApplyOutput>;
}

export const newKey = () => crypto.randomUUID();
