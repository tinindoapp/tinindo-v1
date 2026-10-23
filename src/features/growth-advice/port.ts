// Portas do módulo Metas e conteúdo (P22). Demonstração: emulação na aba, sempre rotulada; servidor: Edge Function `growth-advice`.
import type { AdviceListOutput, ContentListOutput, Goal, GoalListOutput, GoalMetricKey, GoalSaveInput } from "@contracts";
import type { z } from "zod";

export type GoalInput = z.input<typeof GoalSaveInput>;
export type GoalList = z.infer<typeof GoalListOutput>;
export type Advice = z.infer<typeof AdviceListOutput>;
export type Content = z.infer<typeof ContentListOutput>;
export type { Goal, GoalMetricKey };

export interface GrowthAdvicePort {
  readonly kind: "demo" | "server";
  goals(): Promise<GoalList>;
  saveGoal(input: GoalInput, key: string): Promise<Goal>;
  archiveGoal(goal: Goal, key: string): Promise<Goal>;
  advice(): Promise<Advice>;
  decide(ruleCode: string, decision: "accepted" | "dismissed", key: string): Promise<void>;
  content(): Promise<Content>;
  publish(templateCode: string, key: string): Promise<void>;
  unpublish(expectedVersion: number, key: string): Promise<void>;
  /** Só na demonstração: 30 dias passam e o worker acompanha as decisões. */
  followUp?(): Promise<{ followed_up: number }>;
}

export const newKey = () => crypto.randomUUID();
