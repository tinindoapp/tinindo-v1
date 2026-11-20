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
import type { BusinessDescription, DescribeServiceDraft, SetupDescribeOutput } from "../../../supabase/functions/_shared/domain/setup/describe.ts";

export type DraftInput = z.input<typeof SetupDraftApplyInput>;
export type { BusinessDescription, DescribeServiceDraft, SetupDescribeDraft, SetupDescribeOutput, SetupProgress, SetupServiceDraft, SetupStep, SetupStepCode, SetupTemplatesOutput };
export type SetupTemplate = SetupTemplatesOutput["templates"][number];
export type CreatedService = SetupServicesApplyOutput["created"][number];

export interface SetupPort {
  readonly kind: "demo" | "server";
  /**
   * Só na demonstração: a gravação daqui chega à Agenda (`hours`) e ao catálogo de Serviços (`services`) desta aba?
   * false = fica só na tela de Configuração, e a confirmação diz isso. Com servidor não existe (o banco é um só).
   */
  readonly reach?: { hours: boolean; services: boolean };
  /** Estado calculado pelos dados reais (grava a medição da primeira conclusão de cada passo). */
  progress(): Promise<SetupProgress>;
  dismiss(step: SetupStepCode, dismissed: boolean, key: string): Promise<SetupProgress>;
  templates(): Promise<SetupTemplatesOutput>;
  /**
   * Lê a frase do negócio e devolve o rascunho para revisão (nada é gravado). Regras primeiro; com servidor, o
   * assistente completa só o que ficou sem ler e cada campo diz de onde veio (`sources`).
   */
  describe(sentence: string, key: string): Promise<SetupDescribeOutput>;
  /** Cria os serviços confirmados pelo dono, tudo ou nada. */
  applyServices(services: SetupServiceDraft[], key: string): Promise<SetupServicesApplyOutput>;
  /** Aplica o rascunho revisado (profissão, expediente, serviços), tudo ou nada. */
  applyDraft(input: DraftInput, key: string): Promise<SetupDraftApplyOutput>;
}

