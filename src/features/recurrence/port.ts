// Portas do módulo Assinaturas (P20). Demonstração: emulação na aba, sempre rotulada; servidor: Edge Function `recurrence`.
import type { ProviderService, RecurrenceCycle, RecurrencePlan, RecurrencePlanSaveInput, RecurrenceSubscription } from "@contracts";
import type { z } from "zod";

export type PlanInput = z.input<typeof RecurrencePlanSaveInput>;
export type { ProviderService, RecurrenceCycle, RecurrencePlan, RecurrenceSubscription };

export interface RecurrenceBase {
  timezone: string;
  customers: { id: string; name: string }[];
  services: ProviderService[];
}

export interface RecurrencePort {
  readonly kind: "demo" | "server";
  base(): Promise<RecurrenceBase>;
  plans(): Promise<RecurrencePlan[]>;
  savePlan(input: PlanInput, key: string): Promise<RecurrencePlan>;
  subscriptions(): Promise<RecurrenceSubscription[]>;
  subscribe(planId: string, customerId: string, key: string): Promise<RecurrenceSubscription>;
  cancel(sub: RecurrenceSubscription, atPeriodEnd: boolean, reason: string | null, key: string): Promise<RecurrenceSubscription>;
  resume(sub: RecurrenceSubscription, key: string): Promise<RecurrenceSubscription>;
  cycles(subscriptionId: string): Promise<RecurrenceCycle[]>;
  /** Só na demonstração: uma rodada do worker (renova o que venceu). */
  tick?(): Promise<{ renewed: number; closed: number }>;
}

export const newKey = () => crypto.randomUUID();
