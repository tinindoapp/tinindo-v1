// Porta de dados de Preços (P05). Demonstração: emulação na aba; servidor: Edge Function `pricing` + `crm`.
import type {
  ActionApproval,
  PricingApproveRuleInput,
  PricingDeactivateRuleInput,
  PricingProposeRuleInput,
  PricingPublishRuleInput,
  PricingRule,
  PricingRuleProposal,
  ProviderService,
} from "@contracts";
import type { z } from "zod";

export interface PricingPort {
  readonly kind: "demo" | "server";
  services(): Promise<ProviderService[]>;
  list(): Promise<{ rules: PricingRule[]; proposals: PricingRuleProposal[] }>;
  propose(input: z.input<typeof PricingProposeRuleInput>, key: string): Promise<PricingRuleProposal>;
  approve(input: z.input<typeof PricingApproveRuleInput>, key: string): Promise<z.infer<typeof ActionApproval>>;
  publish(input: z.input<typeof PricingPublishRuleInput>, key: string): Promise<PricingRule>;
  deactivate(input: z.input<typeof PricingDeactivateRuleInput>, key: string): Promise<PricingRule>;
  now(): Date;
  timezone(): Promise<string>;
}

export const newKey = () => crypto.randomUUID();
