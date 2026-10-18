// Registro único das operações v1 (docs/03_CONTRATOS.md). Chat e tela usam as mesmas.
// Transporte (ADR-0002): POST /functions/v1/<module>/<operação> com envelope padrão.
import { z } from "zod";
import * as agent from "./agent.ts";
import * as catalog from "./catalog.ts";
import * as finance from "./finance.ts";
import * as network from "./network.ts";
import * as pricing from "./pricing.ts";
import * as scheduling from "./scheduling.ts";
import * as waitlist from "./waitlist.ts";

export type ModuleId =
  | "identity"
  | "crm"
  | "scheduling"
  | "pricing"
  | "waitlist"
  | "finance"
  | "agent"
  | "network";

export interface OperationSpec {
  module: ModuleId;
  /** Pacote responsável pela implementação. */
  owner: `P${number}`;
  kind: "query" | "command";
  /** true = header Idempotency-Key obrigatório; ausente → 400 VALIDATION_ERROR. */
  idempotent: boolean;
  input: z.ZodType;
  output: z.ZodType;
}

const Pending = z.unknown();

export const OPERATIONS = {
  "business.create": {
    module: "identity", owner: "P01", kind: "command", idempotent: true,
    input: catalog.BusinessCreateInput, output: catalog.BusinessCreateOutput,
  },
  "customer.upsert": {
    module: "crm", owner: "P02", kind: "command", idempotent: true,
    input: catalog.CustomerUpsertInput, output: catalog.CustomerUpsertOutput,
  },
  "service.save": {
    module: "crm", owner: "P02", kind: "command", idempotent: true,
    input: catalog.ServiceSaveInput, output: catalog.ServiceSaveOutput,
  },
  "availability.list": {
    module: "scheduling", owner: "P03", kind: "query", idempotent: false,
    input: scheduling.AvailabilityListInput, output: scheduling.AvailabilityListOutput,
  },
  "pricing.quote": {
    module: "pricing", owner: "P05", kind: "query", idempotent: false,
    input: pricing.PricingQuoteInput, output: pricing.Quote,
  },
  "booking.create": {
    module: "scheduling", owner: "P03", kind: "command", idempotent: true,
    input: scheduling.BookingCreateInput, output: scheduling.BookingOutput,
  },
  "booking.reschedule": {
    module: "scheduling", owner: "P03", kind: "command", idempotent: true,
    input: scheduling.BookingRescheduleInput, output: scheduling.BookingOutput,
  },
  "booking.cancel": {
    module: "scheduling", owner: "P03", kind: "command", idempotent: true,
    input: scheduling.BookingCancelInput, output: scheduling.BookingOutput,
  },
  "booking.complete": {
    module: "scheduling", owner: "P03", kind: "command", idempotent: true,
    input: scheduling.BookingCompleteInput, output: scheduling.BookingOutput,
  },
  "pricing.propose_rule": {
    module: "pricing", owner: "P05", kind: "command", idempotent: true,
    input: pricing.PricingProposeRuleInput, output: pricing.PricingRuleProposal,
  },
  "pricing.publish_rule": {
    module: "pricing", owner: "P05", kind: "command", idempotent: true,
    input: pricing.PricingPublishRuleInput, output: Pending,
  },
  "waitlist.join": {
    module: "waitlist", owner: "P06", kind: "command", idempotent: true,
    input: waitlist.WaitlistJoinInput, output: waitlist.WaitlistEntry,
  },
  "waitlist.prepare_offer": {
    module: "waitlist", owner: "P06", kind: "command", idempotent: true,
    input: waitlist.WaitlistPrepareOfferInput, output: waitlist.WaitlistOffer,
  },
  "waitlist.accept_offer": {
    module: "waitlist", owner: "P06", kind: "command", idempotent: true,
    input: waitlist.WaitlistAcceptOfferInput, output: scheduling.BookingOutput,
  },
  "finance.record_payment": {
    module: "finance", owner: "P07", kind: "command", idempotent: true,
    input: finance.FinanceRecordPaymentInput, output: finance.PaymentEntry,
  },
  "finance.summary": {
    module: "finance", owner: "P07", kind: "query", idempotent: false,
    input: finance.FinanceSummaryInput, output: finance.FinanceSummaryOutput,
  },
  "package.consume": {
    module: "finance", owner: "P07", kind: "command", idempotent: true,
    input: finance.PackageConsumeInput, output: finance.PackageBalance,
  },
  "agent.ask": {
    module: "agent", owner: "P08", kind: "query", idempotent: false,
    input: agent.AgentAskInput, output: agent.AgentAnswer,
  },
  "action.approve": {
    module: "agent", owner: "P08", kind: "command", idempotent: true,
    input: agent.ActionApproveInput, output: agent.ActionApproval,
  },
  "action.execute": {
    module: "agent", owner: "P08", kind: "command", idempotent: true,
    input: agent.ActionExecuteInput, output: agent.ActionReceipt,
  },
  "profile.publish": {
    module: "network", owner: "P09", kind: "command", idempotent: true,
    input: network.ProfilePublishInput, output: network.PublicProfile,
  },
  "referral.create": {
    module: "network", owner: "P09", kind: "command", idempotent: true,
    input: network.ReferralCreateInput, output: network.ReferralLink,
  },
} as const satisfies Record<string, OperationSpec>;

export type OperationName = keyof typeof OPERATIONS;
export const OPERATION_NAMES = Object.keys(OPERATIONS) as OperationName[];

/** Caminho HTTP lógico da operação: /<module>/<nome-sem-prefixo>. */
export function operationPath(name: OperationName): string {
  return `/${OPERATIONS[name].module}/${name}`;
}
