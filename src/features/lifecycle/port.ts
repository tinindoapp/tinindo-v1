// Portas do módulo Relacionamento (P13). Demonstração: emulação na aba, sempre rotulada; servidor: Edge Function `lifecycle`.
import type { LifecycleAudienceOutput, LifecycleCampaign, LifecycleSettings, LifecycleStep, LifecycleStepsListOutput, LifecycleStepStatus } from "@contracts";
import type { z } from "zod";

export type Audience = z.infer<typeof LifecycleAudienceOutput>;
export type StepsList = z.infer<typeof LifecycleStepsListOutput>;
export type { LifecycleCampaign, LifecycleSettings, LifecycleStep, LifecycleStepStatus };

export interface LifecyclePort {
  readonly kind: "demo" | "server";
  settings(): Promise<{ settings: LifecycleSettings; sent_today: number }>;
  saveSettings(patch: Partial<Omit<LifecycleSettings, "version">>, expectedVersion: number, key: string): Promise<{ settings: LifecycleSettings; sent_today: number }>;
  steps(status: LifecycleStepStatus | null): Promise<StepsList>;
  markShared(stepId: string, key: string): Promise<LifecycleStep>;
  cancelStep(stepId: string, key: string): Promise<LifecycleStep>;
  setConsent(customerId: string, purpose: "transactional" | "marketing", granted: boolean, key: string): Promise<boolean>;
  audience(): Promise<Audience>;
  approveCampaign(audienceHash: string, maxSends: number, key: string): Promise<LifecycleCampaign>;
  campaigns(): Promise<LifecycleCampaign[]>;
  /** Só na demonstração: uma rodada do worker (no servidor, o cron faz isso). */
  tick?(): Promise<{ sent: number; manual: number; skipped: number; deferred: number; cancelled: number; created: number }>;
}

export const newKey = () => crypto.randomUUID();
