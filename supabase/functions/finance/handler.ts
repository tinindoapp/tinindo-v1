// Edge Function `finance` (P07): recebíveis, recebimentos manuais com estorno, despesas e pacotes de sessões.
// Cada operação é uma RPC transacional do dono (ver _shared/http/rpc-handler.ts). Valores sempre em centavos.
import {
  FinanceCancelReceivableInput,
  FinanceChargeBookingInput,
  FinanceCreateReceivableInput,
  FinanceLedgerOutput,
  FinancePeriodInput,
  FinanceRecordExpenseInput,
  FinanceRecordPaymentInput,
  FinanceReverseExpenseInput,
  FinanceReversePaymentInput,
  FinanceSummaryInput,
  FinanceSummaryOutput,
  FinanceUnchargedOutput,
  ExpenseEntry,
  PackageBalance,
  PackageConsumeInput,
  PackageListInput,
  PackageListOutput,
  PackageReverseInput,
  PackageSellInput,
  PackageSellOutput,
  PaymentEntry,
  PaymentRecord,
  ReceivableOutput,
} from "../_shared/contracts/index.ts";
import { createRpcHandler, type Route, route, type RpcHandlerDeps } from "../_shared/http/rpc-handler.ts";

export type FinanceDeps = RpcHandlerDeps;

const period = (p: { starts_at: string; ends_at: string }) => ({ p_from: p.starts_at, p_to: p.ends_at });

export const FINANCE_ROUTES: Record<string, Route> = {
  "finance.create_receivable": route({
    rpc: "finance_receivable_create", input: FinanceCreateReceivableInput, output: ReceivableOutput, command: true,
    args: (i) => ({ p_customer_id: i.customer_id, p_description: i.description, p_amount_cents: i.amount_cents, p_due_at: i.due_at }),
  }),
  "finance.charge_booking": route({
    rpc: "finance_charge_booking", input: FinanceChargeBookingInput, output: ReceivableOutput, command: true,
    args: (i) => ({ p_booking_id: i.booking_id, p_due_at: i.due_at }),
  }),
  "finance.cancel_receivable": route({
    rpc: "finance_receivable_cancel", input: FinanceCancelReceivableInput, output: ReceivableOutput, command: true,
    args: (i) => ({ p_receivable_id: i.receivable_id, p_expected_version: i.expected_version }),
  }),
  "finance.record_payment": route({
    rpc: "finance_record_payment", input: FinanceRecordPaymentInput, output: PaymentEntry, command: true,
    args: (i) => ({ p_receivable_id: i.receivable_id, p_amount_cents: i.amount_cents, p_method: i.method, p_received_at: i.received_at }),
  }),
  "finance.reverse_payment": route({
    rpc: "finance_reverse_payment", input: FinanceReversePaymentInput, output: PaymentRecord, command: true,
    args: (i) => ({ p_payment_id: i.payment_id, p_reason: i.reason }),
  }),
  "finance.record_expense": route({
    rpc: "finance_record_expense", input: FinanceRecordExpenseInput, output: ExpenseEntry, command: true,
    args: (i) => ({ p_amount_cents: i.amount_cents, p_paid_at: i.paid_at, p_category: i.category, p_description: i.description }),
  }),
  "finance.reverse_expense": route({
    rpc: "finance_reverse_expense", input: FinanceReverseExpenseInput, output: ExpenseEntry, command: true,
    args: (i) => ({ p_expense_id: i.expense_id }),
  }),
  "finance.summary": route({
    rpc: "finance_summary", input: FinanceSummaryInput, output: FinanceSummaryOutput, command: false,
    args: (i) => period(i.period),
  }),
  "finance.ledger": route({
    rpc: "finance_ledger", input: FinancePeriodInput, output: FinanceLedgerOutput, command: false,
    args: (i) => period(i.period),
  }),
  "finance.uncharged": route({
    rpc: "finance_uncharged", input: FinancePeriodInput, output: FinanceUnchargedOutput, command: false,
    args: (i) => period(i.period),
  }),
  "package.sell": route({
    rpc: "package_sell", input: PackageSellInput, output: PackageSellOutput, command: true,
    args: (i) => ({
      p_customer_id: i.customer_id, p_service_id: i.service_id, p_credits: i.credits,
      p_total_price_cents: i.total_price_cents, p_expires_at: i.expires_at,
    }),
  }),
  "package.consume": route({
    rpc: "package_consume", input: PackageConsumeInput, output: PackageBalance, command: true,
    args: (i) => ({ p_package_id: i.package_id, p_booking_id: i.booking_id, p_event_id: i.event_id }),
  }),
  "package.reverse": route({
    rpc: "package_reverse", input: PackageReverseInput, output: PackageBalance, command: true,
    args: (i) => ({ p_entry_id: i.entry_id, p_reason: i.reason }),
  }),
  "package.list": route({
    rpc: "package_list", input: PackageListInput, output: PackageListOutput, command: false,
    args: () => ({}),
  }),
};

export const createFinanceHandler = (deps: FinanceDeps) => createRpcHandler("finance", FINANCE_ROUTES, deps);
