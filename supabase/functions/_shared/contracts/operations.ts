// Registro único das operações v1 (docs/03_CONTRATOS.md). Chat e tela usam as mesmas.
// Transporte (ADR-0002): POST /functions/v1/<module>/<operação> com envelope padrão.
import { z } from "zod";
import * as agent from "./agent.ts";
import * as catalog from "./catalog.ts";
import * as crm from "./crm.ts";
import * as finance from "./finance.ts";
import * as identity from "./identity.ts";
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
/** Consulta sem parâmetros (o contexto vem do JWT e do header de tenant). */
const NoInput = z.object({});

export const OPERATIONS = {
  "business.create": {
    module: "identity", owner: "P01", kind: "command", idempotent: true,
    input: catalog.BusinessCreateInput, output: catalog.BusinessCreateOutput,
  },
  "onboarding.save": {
    module: "identity", owner: "P01", kind: "command", idempotent: true,
    input: identity.OnboardingSaveInput, output: identity.OnboardingSaveOutput,
  },
  "customer_link.issue": {
    module: "identity", owner: "P01", kind: "command", idempotent: true,
    input: identity.CustomerLinkIssueInput, output: identity.CustomerLinkIssueOutput,
  },
  "customer_link.redeem": {
    module: "identity", owner: "P01", kind: "command", idempotent: true,
    input: identity.CustomerLinkRedeemInput, output: identity.CustomerLinkRedeemOutput,
  },
  "customer_link.revoke": {
    module: "identity", owner: "P01", kind: "command", idempotent: true,
    input: identity.CustomerLinkRevokeInput, output: identity.CustomerLinkRevokeOutput,
  },
  "customer.upsert": {
    module: "crm", owner: "P02", kind: "command", idempotent: true,
    input: catalog.CustomerUpsertInput, output: catalog.CustomerUpsertOutput,
  },
  "service.save": {
    module: "crm", owner: "P02", kind: "command", idempotent: true,
    input: catalog.ServiceSaveInput, output: catalog.ServiceSaveOutput,
  },
  "customer.archive": {
    module: "crm", owner: "P02", kind: "command", idempotent: true,
    input: crm.CustomerArchiveInput, output: crm.CustomerArchiveOutput,
  },
  "customer.list": {
    module: "crm", owner: "P02", kind: "query", idempotent: false,
    input: crm.CustomerListQuery, output: crm.CustomerListOutput,
  },
  "service.list": {
    module: "crm", owner: "P02", kind: "query", idempotent: false,
    input: crm.ServiceListQuery, output: crm.ServiceListOutput,
  },
  "customer.import_preview": {
    module: "crm", owner: "P02", kind: "query", idempotent: false,
    input: crm.ImportPreviewInput, output: crm.ImportPreviewOutput,
  },
  "customer.import": {
    module: "crm", owner: "P02", kind: "command", idempotent: true,
    input: crm.ImportInput, output: crm.ImportOutput,
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
  "profile.unpublish": {
    module: "network", owner: "P09", kind: "command", idempotent: true,
    input: NoInput, output: network.ProfileUnpublishOutput,
  },
  "profile.get": {
    module: "network", owner: "P09", kind: "query", idempotent: false,
    input: NoInput, output: network.OwnerProfileOutput,
  },
  "public.profile": {
    module: "network", owner: "P09", kind: "query", idempotent: false,
    input: network.PublicProfileQuery, output: network.PublicProfile,
  },
  "public.slots": {
    module: "network", owner: "P09", kind: "query", idempotent: false,
    input: network.PublicSlotsInput, output: scheduling.AvailabilityListOutput,
  },
  "referral.create": {
    module: "network", owner: "P09", kind: "command", idempotent: true,
    input: network.ReferralCreateInput, output: network.ReferralLink,
  },
  "referral.inspect": {
    module: "network", owner: "P09", kind: "query", idempotent: false,
    input: network.ReferralTokenInput, output: network.ReferralInspectOutput,
  },
  "referral.claim": {
    module: "network", owner: "P09", kind: "command", idempotent: true,
    input: network.ReferralTokenInput, output: network.ReferralClaimOutput,
  },
  "referral.list": {
    module: "network", owner: "P09", kind: "query", idempotent: false,
    input: NoInput, output: network.ReferralListOutput,
  },
} as const satisfies Record<string, OperationSpec>;

export type OperationName = keyof typeof OPERATIONS;
export const OPERATION_NAMES = Object.keys(OPERATIONS) as OperationName[];

/** Caminho HTTP lógico da operação: /<module>/<nome-sem-prefixo>. */
export function operationPath(name: OperationName): string {
  return `/${OPERATIONS[name].module}/${name}`;
}
