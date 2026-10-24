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
import * as sales from "./sales.ts";
import * as svc from "./service-ops.ts";
import * as analytics from "./analytics.ts";
import * as messaging from "./messaging.ts";
import * as payments from "./payments.ts";
import * as lifecycle from "./lifecycle.ts";
import * as recurrence from "./recurrence.ts";
import * as referrals from "./referrals.ts";
import * as campaigns from "./campaigns.ts";
import * as growth from "./growth-advice.ts";
import * as presence from "./presence.ts";
import * as fiscal from "./fiscal.ts";
import * as discovery from "./discovery.ts";
import * as reputation from "./reputation.ts";
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
  | "network"
  | "sales"
  | "service-ops"
  | "analytics"
  | "messaging"
  | "payments"
  | "lifecycle"
  | "recurrence"
  | "referrals"
  | "campaigns"
  | "growth-advice"
  | "presence"
  | "fiscal"
  | "discovery"
  | "reputation";

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
  "booking.confirm": {
    module: "scheduling", owner: "P03", kind: "command", idempotent: true,
    input: scheduling.BookingConfirmInput, output: scheduling.BookingOutput,
  },
  "booking.no_show": {
    module: "scheduling", owner: "P03", kind: "command", idempotent: true,
    input: scheduling.BookingNoShowInput, output: scheduling.BookingOutput,
  },
  "booking.create_series": {
    module: "scheduling", owner: "P03", kind: "command", idempotent: true,
    input: scheduling.BookingCreateSeriesInput, output: scheduling.BookingCreateSeriesOutput,
  },
  "booking.list": {
    module: "scheduling", owner: "P03", kind: "query", idempotent: false,
    input: scheduling.BookingListInput, output: scheduling.BookingListOutput,
  },
  "booking.get": {
    module: "scheduling", owner: "P03", kind: "query", idempotent: false,
    input: scheduling.BookingGetInput, output: scheduling.BookingOutput,
  },
  "schedule.settings": {
    module: "scheduling", owner: "P03", kind: "query", idempotent: false,
    input: scheduling.ScheduleSettingsInput, output: scheduling.ScheduleSettings,
  },
  "schedule.rules_save": {
    module: "scheduling", owner: "P03", kind: "command", idempotent: true,
    input: scheduling.ScheduleRulesSaveInput, output: scheduling.ScheduleSettings,
  },
  "schedule.day_plans": {
    module: "scheduling", owner: "P03", kind: "query", idempotent: false,
    input: scheduling.ScheduleDayPlansInput, output: scheduling.ScheduleDayPlansOutput,
  },
  "schedule.block_create": {
    module: "scheduling", owner: "P03", kind: "command", idempotent: true,
    input: scheduling.ScheduleBlockCreateInput, output: scheduling.ScheduleBlockOutput,
  },
  "schedule.block_remove": {
    module: "scheduling", owner: "P03", kind: "command", idempotent: true,
    input: scheduling.ScheduleBlockRemoveInput, output: scheduling.ScheduleBlockOutput,
  },
  "pricing.propose_rule": {
    module: "pricing", owner: "P05", kind: "command", idempotent: true,
    input: pricing.PricingProposeRuleInput, output: pricing.PricingRuleProposal,
  },
  "pricing.approve_rule": {
    module: "pricing", owner: "P05", kind: "command", idempotent: true,
    input: pricing.PricingApproveRuleInput, output: agent.ActionApproval,
  },
  "pricing.publish_rule": {
    module: "pricing", owner: "P05", kind: "command", idempotent: true,
    input: pricing.PricingPublishRuleInput, output: pricing.PricingRuleOutput,
  },
  "pricing.deactivate_rule": {
    module: "pricing", owner: "P05", kind: "command", idempotent: true,
    input: pricing.PricingDeactivateRuleInput, output: pricing.PricingRuleOutput,
  },
  "pricing.list_rules": {
    module: "pricing", owner: "P05", kind: "query", idempotent: false,
    input: pricing.PricingListRulesInput, output: pricing.PricingListRulesOutput,
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
  "consent.record": {
    module: "waitlist", owner: "P06", kind: "command", idempotent: true,
    input: waitlist.ConsentRecordInput, output: waitlist.ContactConsent,
  },
  "consent.revoke": {
    module: "waitlist", owner: "P06", kind: "command", idempotent: true,
    input: waitlist.ConsentRevokeInput, output: waitlist.ConsentRevokeOutput,
  },
  "waitlist.withdraw": {
    module: "waitlist", owner: "P06", kind: "command", idempotent: true,
    input: waitlist.WaitlistWithdrawInput, output: waitlist.WaitlistEntry,
  },
  "waitlist.mark_shared": {
    module: "waitlist", owner: "P06", kind: "command", idempotent: true,
    input: waitlist.WaitlistOfferRefInput, output: waitlist.WaitlistOffer,
  },
  "waitlist.cancel_offer": {
    module: "waitlist", owner: "P06", kind: "command", idempotent: true,
    input: waitlist.WaitlistOfferRefInput, output: waitlist.WaitlistOffer,
  },
  "waitlist.list": {
    module: "waitlist", owner: "P06", kind: "query", idempotent: false,
    input: waitlist.WaitlistListInput, output: waitlist.WaitlistListOutput,
  },
  "waitlist.offer_view": {
    module: "waitlist", owner: "P06", kind: "query", idempotent: false,
    input: waitlist.WaitlistAcceptOfferInput, output: waitlist.WaitlistOfferView,
  },
  "waitlist.decline_offer": {
    module: "waitlist", owner: "P06", kind: "command", idempotent: true,
    input: waitlist.WaitlistAcceptOfferInput, output: waitlist.WaitlistDeclineOutput,
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
  "finance.create_receivable": {
    module: "finance", owner: "P07", kind: "command", idempotent: true,
    input: finance.FinanceCreateReceivableInput, output: finance.ReceivableOutput,
  },
  "finance.charge_booking": {
    module: "finance", owner: "P07", kind: "command", idempotent: true,
    input: finance.FinanceChargeBookingInput, output: finance.ReceivableOutput,
  },
  "finance.cancel_receivable": {
    module: "finance", owner: "P07", kind: "command", idempotent: true,
    input: finance.FinanceCancelReceivableInput, output: finance.ReceivableOutput,
  },
  "finance.reverse_payment": {
    module: "finance", owner: "P07", kind: "command", idempotent: true,
    input: finance.FinanceReversePaymentInput, output: finance.PaymentRecord,
  },
  "finance.record_expense": {
    module: "finance", owner: "P07", kind: "command", idempotent: true,
    input: finance.FinanceRecordExpenseInput, output: finance.ExpenseEntry,
  },
  "finance.reverse_expense": {
    module: "finance", owner: "P07", kind: "command", idempotent: true,
    input: finance.FinanceReverseExpenseInput, output: finance.ExpenseEntry,
  },
  "finance.ledger": {
    module: "finance", owner: "P07", kind: "query", idempotent: false,
    input: finance.FinancePeriodInput, output: finance.FinanceLedgerOutput,
  },
  "finance.uncharged": {
    module: "finance", owner: "P07", kind: "query", idempotent: false,
    input: finance.FinancePeriodInput, output: finance.FinanceUnchargedOutput,
  },
  "package.sell": {
    module: "finance", owner: "P07", kind: "command", idempotent: true,
    input: finance.PackageSellInput, output: finance.PackageSellOutput,
  },
  "package.reverse": {
    module: "finance", owner: "P07", kind: "command", idempotent: true,
    input: finance.PackageReverseInput, output: finance.PackageBalance,
  },
  "package.list": {
    module: "finance", owner: "P07", kind: "query", idempotent: false,
    input: finance.PackageListInput, output: finance.PackageListOutput,
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
  "quote.create": {
    module: "sales", owner: "P11", kind: "command", idempotent: true,
    input: sales.SalesQuoteCreateInput, output: sales.SalesQuoteOutput,
  },
  "quote.revise": {
    module: "sales", owner: "P11", kind: "command", idempotent: true,
    input: sales.SalesQuoteReviseInput, output: sales.SalesQuoteOutput,
  },
  "quote.send": {
    module: "sales", owner: "P11", kind: "command", idempotent: true,
    input: sales.SalesQuoteSendInput, output: sales.SalesQuoteSendOutput,
  },
  "quote.cancel": {
    module: "sales", owner: "P11", kind: "command", idempotent: true,
    input: sales.SalesQuoteRefInput, output: sales.SalesQuoteOutput,
  },
  "quote.list": {
    module: "sales", owner: "P11", kind: "query", idempotent: false,
    input: sales.SalesQuoteListInput, output: sales.SalesQuoteListOutput,
  },
  "quote.get": {
    module: "sales", owner: "P11", kind: "query", idempotent: false,
    input: sales.SalesQuoteRefInput, output: sales.SalesQuoteDetailOutput,
  },
  "quote.view": {
    module: "sales", owner: "P11", kind: "query", idempotent: false,
    input: sales.SalesQuoteTokenInput, output: sales.SalesQuotePublicView,
  },
  "quote.accept": {
    module: "sales", owner: "P11", kind: "command", idempotent: true,
    input: sales.SalesQuoteDecideInput, output: sales.SalesQuoteDecideOutput,
  },
  "quote.decline": {
    module: "sales", owner: "P11", kind: "command", idempotent: true,
    input: sales.SalesQuoteDecideInput, output: sales.SalesQuoteDecideOutput,
  },
  "plan.current": {
    module: "service-ops", owner: "P15", kind: "query", idempotent: false,
    input: svc.PlanCurrentInput, output: svc.PlanCurrentOutput,
  },
  "plan.subscribe": {
    module: "service-ops", owner: "P15", kind: "command", idempotent: true,
    input: svc.PlanSubscribeInput, output: svc.PlanCurrentOutput,
  },
  "order.request": {
    module: "service-ops", owner: "P15", kind: "command", idempotent: true,
    input: svc.OrderRequestInput, output: svc.OrderOutput,
  },
  "order.list": {
    module: "service-ops", owner: "P15", kind: "query", idempotent: false,
    input: svc.OrderListInput, output: svc.OrderListOutput,
  },
  "order.cancel": {
    module: "service-ops", owner: "P15", kind: "command", idempotent: true,
    input: svc.OrderCancelInput, output: svc.OrderOutput,
  },
  "order.review_delivery": {
    module: "service-ops", owner: "P15", kind: "command", idempotent: true,
    input: svc.DeliveryReviewInput, output: svc.OrderOutput,
  },
  "access.grant": {
    module: "service-ops", owner: "P15", kind: "command", idempotent: true,
    input: svc.AccessGrantInput, output: svc.AccessGrantOutput,
  },
  "access.revoke": {
    module: "service-ops", owner: "P15", kind: "command", idempotent: true,
    input: svc.AccessRevokeInput, output: svc.AccessGrantOutput,
  },
  "access.log": {
    module: "service-ops", owner: "P15", kind: "query", idempotent: false,
    input: svc.AccessLogInput, output: svc.AccessLogOutput,
  },
  "ops.queue": {
    module: "service-ops", owner: "P15", kind: "query", idempotent: false,
    input: svc.OpsQueueInput, output: svc.OpsQueueOutput,
  },
  "ops.assign": {
    module: "service-ops", owner: "P15", kind: "command", idempotent: true,
    input: svc.OpsAssignInput, output: svc.OrderOutput,
  },
  "ops.start": {
    module: "service-ops", owner: "P15", kind: "command", idempotent: true,
    input: svc.OpsOrderRefInput, output: svc.OrderOutput,
  },
  "ops.log_work": {
    module: "service-ops", owner: "P15", kind: "command", idempotent: true,
    input: svc.OpsLogWorkInput, output: svc.OpsLogWorkOutput,
  },
  "ops.deliver": {
    module: "service-ops", owner: "P15", kind: "command", idempotent: true,
    input: svc.OpsDeliverInput, output: svc.OpsDeliverOutput,
  },
  "ops.block": {
    module: "service-ops", owner: "P15", kind: "command", idempotent: true,
    input: svc.OpsBlockInput, output: svc.OrderOutput,
  },
  "ops.snapshot": {
    module: "service-ops", owner: "P15", kind: "query", idempotent: false,
    input: svc.OpsOrderRefInput, output: svc.OpsSnapshotOutput,
  },
  "analytics.metrics": {
    module: "analytics", owner: "P18", kind: "query", idempotent: false,
    input: analytics.AnalyticsMetricsInput, output: analytics.AnalyticsMetricsOutput,
  },
  "analytics.baseline_create": {
    module: "analytics", owner: "P18", kind: "command", idempotent: true,
    input: analytics.AnalyticsBaselineCreateInput, output: analytics.AnalyticsBaselineOutput,
  },
  "analytics.baseline_list": {
    module: "analytics", owner: "P18", kind: "query", idempotent: false,
    input: analytics.AnalyticsBaselineListInput, output: analytics.AnalyticsBaselineListOutput,
  },
  "analytics.cost_to_serve": {
    module: "analytics", owner: "P18", kind: "query", idempotent: false,
    input: analytics.CostToServeInput, output: analytics.CostToServeOutput,
  },
  "channel.status": {
    module: "messaging", owner: "P12", kind: "query", idempotent: false,
    input: messaging.ChannelStatusInput, output: messaging.ChannelStatusOutput,
  },
  "channel.connect": {
    module: "messaging", owner: "P12", kind: "command", idempotent: true,
    input: messaging.ChannelConnectInput, output: messaging.ChannelConnectionOutput,
  },
  "channel.verify": {
    module: "messaging", owner: "P12", kind: "command", idempotent: true,
    input: messaging.ChannelVerifyInput, output: messaging.ChannelConnectionOutput,
  },
  "channel.disconnect": {
    module: "messaging", owner: "P12", kind: "command", idempotent: true,
    input: messaging.ChannelDisconnectInput, output: messaging.ChannelConnectionOutput,
  },
  "inbox.list": {
    module: "messaging", owner: "P12", kind: "query", idempotent: false,
    input: messaging.InboxListInput, output: messaging.InboxListOutput,
  },
  "conversation.get": {
    module: "messaging", owner: "P12", kind: "query", idempotent: false,
    input: messaging.ConversationGetInput, output: messaging.ConversationGetOutput,
  },
  "message.send": {
    module: "messaging", owner: "P12", kind: "command", idempotent: true,
    input: messaging.MessageSendInput, output: messaging.MessageSendOutput,
  },
  "conversation.handoff": {
    module: "messaging", owner: "P12", kind: "command", idempotent: true,
    input: messaging.ConversationHandoffInput, output: messaging.ContactOutput,
  },
  "contact.link": {
    module: "messaging", owner: "P12", kind: "command", idempotent: true,
    input: messaging.ContactLinkInput, output: messaging.ContactOutput,
  },
  "contact.consent": {
    module: "messaging", owner: "P12", kind: "command", idempotent: true,
    input: messaging.ContactConsentInput, output: messaging.ContactOutput,
  },
  "sim.phone": {
    module: "messaging", owner: "P12", kind: "query", idempotent: false,
    input: messaging.SimPhoneInput, output: messaging.SimPhoneOutput,
  },
  "sim.inbound": {
    module: "messaging", owner: "P12", kind: "command", idempotent: true,
    input: messaging.SimInboundInput, output: messaging.SimInboundOutput,
  },
  "payment.charges": {
    module: "payments", owner: "P14", kind: "query", idempotent: false,
    input: payments.ChargesListInput, output: payments.ChargesListOutput,
  },
  "payment.charge_create": {
    module: "payments", owner: "P14", kind: "command", idempotent: true,
    input: payments.ChargeCreateInput, output: payments.ChargeCreateOutput,
  },
  "payment.charge_cancel": {
    module: "payments", owner: "P14", kind: "command", idempotent: true,
    input: payments.ChargeCancelInput, output: payments.ChargeOutput,
  },
  "payment.refund": {
    module: "payments", owner: "P14", kind: "command", idempotent: true,
    input: payments.RefundRequestInput, output: payments.RefundOutput,
  },
  "payment.reconcile": {
    module: "payments", owner: "P14", kind: "command", idempotent: true,
    input: payments.ReconcileInput, output: payments.ReconcileOutput,
  },
  "payment.reconciliations": {
    module: "payments", owner: "P14", kind: "query", idempotent: false,
    input: payments.ReconciliationsListInput, output: payments.ReconciliationsListOutput,
  },
  "payment.link_view": {
    module: "payments", owner: "P14", kind: "query", idempotent: false,
    input: payments.PaymentLinkInput, output: payments.PaymentLinkView,
  },
  "payment.sim_pay": {
    module: "payments", owner: "P14", kind: "command", idempotent: true,
    input: payments.SimPayInput, output: payments.SimPayOutput,
  },
  "lifecycle.settings_get": {
    module: "lifecycle", owner: "P13", kind: "query", idempotent: false,
    input: lifecycle.LifecycleSettingsGetInput, output: lifecycle.LifecycleSettingsOutput,
  },
  "lifecycle.settings_save": {
    module: "lifecycle", owner: "P13", kind: "command", idempotent: true,
    input: lifecycle.LifecycleSettingsSaveInput, output: lifecycle.LifecycleSettingsOutput,
  },
  "lifecycle.steps": {
    module: "lifecycle", owner: "P13", kind: "query", idempotent: false,
    input: lifecycle.LifecycleStepsListInput, output: lifecycle.LifecycleStepsListOutput,
  },
  "lifecycle.step_mark_shared": {
    module: "lifecycle", owner: "P13", kind: "command", idempotent: true,
    input: lifecycle.LifecycleStepRefInput, output: lifecycle.LifecycleStepOutput,
  },
  "lifecycle.step_cancel": {
    module: "lifecycle", owner: "P13", kind: "command", idempotent: true,
    input: lifecycle.LifecycleStepRefInput, output: lifecycle.LifecycleStepOutput,
  },
  "lifecycle.consent_set": {
    module: "lifecycle", owner: "P13", kind: "command", idempotent: true,
    input: lifecycle.LifecycleConsentSetInput, output: lifecycle.LifecycleConsentOutput,
  },
  "lifecycle.audience": {
    module: "lifecycle", owner: "P13", kind: "query", idempotent: false,
    input: lifecycle.LifecycleAudienceInput, output: lifecycle.LifecycleAudienceOutput,
  },
  "lifecycle.campaign_approve": {
    module: "lifecycle", owner: "P13", kind: "command", idempotent: true,
    input: lifecycle.LifecycleCampaignApproveInput, output: lifecycle.LifecycleCampaignOutput,
  },
  "lifecycle.campaigns": {
    module: "lifecycle", owner: "P13", kind: "query", idempotent: false,
    input: lifecycle.LifecycleCampaignListInput, output: lifecycle.LifecycleCampaignListOutput,
  },
  "recurrence.plan_save": {
    module: "recurrence", owner: "P20", kind: "command", idempotent: true,
    input: recurrence.RecurrencePlanSaveInput, output: recurrence.RecurrencePlanOutput,
  },
  "recurrence.plans": {
    module: "recurrence", owner: "P20", kind: "query", idempotent: false,
    input: recurrence.RecurrencePlanListInput, output: recurrence.RecurrencePlanListOutput,
  },
  "recurrence.subscribe": {
    module: "recurrence", owner: "P20", kind: "command", idempotent: true,
    input: recurrence.RecurrenceSubscribeInput, output: recurrence.RecurrenceSubscriptionOutput,
  },
  "recurrence.cancel": {
    module: "recurrence", owner: "P20", kind: "command", idempotent: true,
    input: recurrence.RecurrenceCancelInput, output: recurrence.RecurrenceSubscriptionOutput,
  },
  "recurrence.resume": {
    module: "recurrence", owner: "P20", kind: "command", idempotent: true,
    input: recurrence.RecurrenceResumeInput, output: recurrence.RecurrenceSubscriptionOutput,
  },
  "recurrence.subscriptions": {
    module: "recurrence", owner: "P20", kind: "query", idempotent: false,
    input: recurrence.RecurrenceListInput, output: recurrence.RecurrenceListOutput,
  },
  "recurrence.cycles": {
    module: "recurrence", owner: "P20", kind: "query", idempotent: false,
    input: recurrence.RecurrenceCyclesInput, output: recurrence.RecurrenceCyclesOutput,
  },
  "referrals.dashboard": {
    module: "referrals", owner: "P21", kind: "query", idempotent: false,
    input: referrals.ReferralDashboardInput, output: referrals.ReferralDashboardOutput,
  },
  "referrals.rewards": {
    module: "referrals", owner: "P21", kind: "query", idempotent: false,
    input: referrals.ReferralRewardsListInput, output: referrals.ReferralRewardsListOutput,
  },
  "campaign.preview": {
    module: "campaigns", owner: "P19", kind: "query", idempotent: false,
    input: campaigns.CampaignPreviewInput, output: campaigns.CampaignPreviewOutput,
  },
  "campaign.approve": {
    module: "campaigns", owner: "P19", kind: "command", idempotent: true,
    input: campaigns.CampaignApproveInput, output: campaigns.CampaignOutput,
  },
  "campaign.list": {
    module: "campaigns", owner: "P19", kind: "query", idempotent: false,
    input: campaigns.CampaignListInput, output: campaigns.CampaignListOutput,
  },
  "campaign.get": {
    module: "campaigns", owner: "P19", kind: "query", idempotent: false,
    input: campaigns.CampaignGetInput, output: campaigns.CampaignGetOutput,
  },
  "campaign.cancel": {
    module: "campaigns", owner: "P19", kind: "command", idempotent: true,
    input: campaigns.CampaignCancelInput, output: campaigns.CampaignOutput,
  },
  "goal.save": { module: "growth-advice", owner: "P22", kind: "command", idempotent: true, input: growth.GoalSaveInput, output: growth.GoalOutput },
  "goal.archive": { module: "growth-advice", owner: "P22", kind: "command", idempotent: true, input: growth.GoalArchiveInput, output: growth.GoalOutput },
  "goal.list": { module: "growth-advice", owner: "P22", kind: "query", idempotent: false, input: growth.GoalListInput, output: growth.GoalListOutput },
  "advice.list": { module: "growth-advice", owner: "P22", kind: "query", idempotent: false, input: growth.AdviceListInput, output: growth.AdviceListOutput },
  "advice.decide": { module: "growth-advice", owner: "P22", kind: "command", idempotent: true, input: growth.AdviceDecideInput, output: growth.AdviceDecideOutput },
  "content.list": { module: "growth-advice", owner: "P22", kind: "query", idempotent: false, input: growth.ContentListInput, output: growth.ContentListOutput },
  "content.publish": { module: "growth-advice", owner: "P22", kind: "command", idempotent: true, input: growth.ContentPublishInput, output: growth.ContentPublishOutput },
  "content.unpublish": { module: "growth-advice", owner: "P22", kind: "command", idempotent: true, input: growth.ContentUnpublishInput, output: growth.ContentPublishOutput },
  "presence.get": { module: "presence", owner: "P17", kind: "query", idempotent: false, input: presence.PresenceGetInput, output: presence.PresenceOverview },
  "site.save": { module: "presence", owner: "P17", kind: "command", idempotent: true, input: presence.SiteSaveInput, output: presence.PresenceOverview },
  "site.publish": { module: "presence", owner: "P17", kind: "command", idempotent: true, input: presence.SitePublishInput, output: presence.PresenceOverview },
  "site.unpublish": { module: "presence", owner: "P17", kind: "command", idempotent: true, input: presence.SiteUnpublishInput, output: presence.PresenceOverview },
  "site.restore": { module: "presence", owner: "P17", kind: "command", idempotent: true, input: presence.SiteRestoreInput, output: presence.PresenceOverview },
  "domain.add": { module: "presence", owner: "P17", kind: "command", idempotent: true, input: presence.DomainAddInput, output: presence.PresenceOverview },
  "domain.remove": { module: "presence", owner: "P17", kind: "command", idempotent: true, input: presence.DomainRemoveInput, output: presence.PresenceOverview },
  "domain.check": { module: "presence", owner: "P17", kind: "query", idempotent: false, input: presence.DomainCheckInput, output: presence.DomainCheckOutput },
  "google.set": { module: "presence", owner: "P17", kind: "command", idempotent: true, input: presence.GoogleSetInput, output: presence.PresenceOverview },
  "ops.presence_delivery": { module: "presence", owner: "P17", kind: "command", idempotent: true, input: presence.DeliveryRecordInput, output: presence.DeliveryRecordOutput },
  "presence.public_site": { module: "presence", owner: "P17", kind: "query", idempotent: false, input: presence.PublicSiteInput, output: presence.PublicSiteOutput },
  "fiscal.get": { module: "fiscal", owner: "P16", kind: "query", idempotent: false, input: fiscal.FiscalGetInput, output: fiscal.FiscalOverview },
  "fiscal.profile_save": { module: "fiscal", owner: "P16", kind: "command", idempotent: true, input: fiscal.FiscalProfileSaveInput, output: fiscal.FiscalOverview },
  "fiscal.representation": { module: "fiscal", owner: "P16", kind: "command", idempotent: true, input: fiscal.FiscalRepresentationInput, output: fiscal.FiscalOverview },
  "fiscal.credential_check": { module: "fiscal", owner: "P16", kind: "query", idempotent: false, input: fiscal.FiscalCredentialCheckInput, output: fiscal.FiscalOverview },
  "fiscal.emit": { module: "fiscal", owner: "P16", kind: "command", idempotent: true, input: fiscal.FiscalEmitInput, output: fiscal.FiscalDocumentOutput },
  "fiscal.cancel": { module: "fiscal", owner: "P16", kind: "command", idempotent: true, input: fiscal.FiscalCancelInput, output: fiscal.FiscalDocumentOutput },
  "fiscal.folder": { module: "fiscal", owner: "P16", kind: "query", idempotent: false, input: fiscal.FiscalFolderInput, output: fiscal.FiscalFolderOutput },
  "discovery.get": { module: "discovery", owner: "P23", kind: "query", idempotent: false, input: discovery.DiscoveryGetInput, output: discovery.DiscoveryOverview },
  "discovery.save": { module: "discovery", owner: "P23", kind: "command", idempotent: true, input: discovery.DiscoverySaveInput, output: discovery.DiscoveryOverview },
  "directory.search": { module: "discovery", owner: "P23", kind: "query", idempotent: false, input: discovery.DirectorySearchInput, output: discovery.DirectorySearchOutput },
  "directory.cities": { module: "discovery", owner: "P23", kind: "query", idempotent: false, input: discovery.DirectoryCitiesInput, output: discovery.DirectoryCitiesOutput },
  "review.pending": { module: "reputation", owner: "P24", kind: "query", idempotent: false, input: reputation.ReviewPendingInput, output: reputation.ReviewPendingOutput },
  "review.submit": { module: "reputation", owner: "P24", kind: "command", idempotent: true, input: reputation.ReviewSubmitInput, output: reputation.MyReviewOutput },
  "review.withdraw": { module: "reputation", owner: "P24", kind: "command", idempotent: true, input: reputation.ReviewWithdrawInput, output: reputation.MyReviewOutput },
  "review.report": { module: "reputation", owner: "P24", kind: "command", idempotent: true, input: reputation.ReviewReportInput, output: reputation.ReviewReportOutput },
  "review.owner_list": { module: "reputation", owner: "P24", kind: "query", idempotent: false, input: reputation.ReviewOwnerListInput, output: reputation.ReviewOwnerListOutput },
  "review.reply": { module: "reputation", owner: "P24", kind: "command", idempotent: true, input: reputation.ReviewReplyInput, output: reputation.ReviewReplyOutput },
  "review.public_list": { module: "reputation", owner: "P24", kind: "query", idempotent: false, input: reputation.ReviewPublicListInput, output: reputation.ReviewPublicListOutput },
} as const satisfies Record<string, OperationSpec>;

export type OperationName = keyof typeof OPERATIONS;
export const OPERATION_NAMES = Object.keys(OPERATIONS) as OperationName[];

/** Caminho HTTP lógico da operação: /<module>/<nome-sem-prefixo>. */
export function operationPath(name: OperationName): string {
  return `/${OPERATIONS[name].module}/${name}`;
}
