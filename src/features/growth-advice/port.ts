// Portas do módulo Metas e sugestões (P22, P45). Demonstração: emulação na aba, sempre rotulada; servidor: Edge Function `growth-advice`.
import type { AdviceListOutput, ContentListOutput, DigestListOutput, Goal, GoalListOutput, GoalMetricKey, GoalSaveInput, Insight, InsightCommandOutput, InsightListOutput } from "@contracts";
import type { z } from "zod";

export type GoalInput = z.input<typeof GoalSaveInput>;
export type GoalList = z.infer<typeof GoalListOutput>;
export type Advice = z.infer<typeof AdviceListOutput>;
export type Content = z.infer<typeof ContentListOutput>;
export type InsightList = z.infer<typeof InsightListOutput>;
export type InsightCommand = z.infer<typeof InsightCommandOutput>;
export type Digests = z.infer<typeof DigestListOutput>;
export type { Goal, GoalMetricKey, Insight };

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
  /** P45: insights do motor diário. `home` traz até 3 abertos, por prioridade. */
  insights(scope: "home" | "all"): Promise<InsightList>;
  /** "Agora não": silencia a regra por 30 dias. */
  snoozeInsight(insight: Insight, key: string): Promise<InsightCommand>;
  /** "Preparar"/"Ver": cria a proposta no fluxo dono ou devolve a tela do fluxo. Nunca executa. */
  actInsight(insight: Insight, key: string): Promise<InsightCommand>;
  /** Resumos semanais por modelo fixo. */
  digests(): Promise<Digests>;
  /** Só na demonstração: 30 dias passam e o worker acompanha as decisões. */
  followUp?(): Promise<{ followed_up: number }>;
}

export const newKey = () => crypto.randomUUID();
