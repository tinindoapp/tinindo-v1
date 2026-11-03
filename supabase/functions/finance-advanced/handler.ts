// Edge Function `finance-advanced` (P31): contas a pagar, categorias, conciliação e demonstrativo de caixa. Cada operação é
// uma RPC transacional do dono (ver _shared/http/rpc-handler.ts). Pagamento único e estorno são garantidos no banco.
import {
  AccCategoriesInput,
  AccCategoriesOutput,
  AccCategoryOutput,
  AccEntriesInput,
  AccEntriesOutput,
  AccCategorySaveInput,
  AccClassifyInput,
  AccClassifyOutput,
  AccPayableOutput,
  AccPayablePayInput,
  AccPayableRefInput,
  AccPayableSaveInput,
  AccPayableSaveOutput,
  AccPayablesInput,
  AccPayablesOutput,
  AccReconcileSaveInput,
  AccReconcileSaveOutput,
  AccReconciliationInput,
  AccReconciliationOutput,
  AccSeriesUpdateInput,
  AccSeriesUpdateOutput,
  AccStatementInput,
  AccStatementOutput,
} from "../_shared/contracts/index.ts";
import { createRpcHandler, type Route, route, type RpcHandlerDeps } from "../_shared/http/rpc-handler.ts";

export type FinanceAdvancedDeps = RpcHandlerDeps;

const ref = (i: { payable_id: string; expected_version: number }) => ({ p_payable_id: i.payable_id, p_expected_version: i.expected_version });

export const FINANCE_ADVANCED_ROUTES: Record<string, Route> = {
  "accounts.categories": route({ rpc: "accounts_categories", input: AccCategoriesInput, output: AccCategoriesOutput, command: false, args: () => ({}) }),
  "accounts.category_save": route({
    rpc: "accounts_category_save", input: AccCategorySaveInput, output: AccCategoryOutput, command: true,
    args: (i) => ({ p_category_id: i.category_id, p_expected_version: i.expected_version, p_kind: i.kind, p_name: i.name, p_base: i.base, p_active: i.active }),
  }),
  "accounts.classify": route({
    rpc: "accounts_classify", input: AccClassifyInput, output: AccClassifyOutput, command: true,
    args: (i) => ({ p_entry_kind: i.entry_kind, p_entry_id: i.entry_id, p_category_id: i.category_id }),
  }),
  "accounts.payables": route({
    rpc: "accounts_payables", input: AccPayablesInput, output: AccPayablesOutput, command: false,
    args: (i) => ({ p_from: i.from, p_to: i.to }),
  }),
  "accounts.payable_save": route({
    rpc: "accounts_payable_save", input: AccPayableSaveInput, output: AccPayableSaveOutput, command: true,
    args: (i) => ({ p_payable_id: i.payable_id, p_expected_version: i.expected_version, p_description: i.description, p_amount_cents: i.amount_cents,
      p_due_on: i.due_on, p_base_category: i.base_category, p_category_id: i.category_id, p_supplier: i.supplier, p_monthly: i.monthly }),
  }),
  "accounts.payable_pay": route({
    rpc: "accounts_payable_pay", input: AccPayablePayInput, output: AccPayableOutput, command: true,
    args: (i) => ({ ...ref(i), p_paid_at: i.paid_at }),
  }),
  "accounts.payable_reverse": route({ rpc: "accounts_payable_reverse", input: AccPayableRefInput, output: AccPayableOutput, command: true, args: ref }),
  "accounts.payable_cancel": route({ rpc: "accounts_payable_cancel", input: AccPayableRefInput, output: AccPayableOutput, command: true, args: ref }),
  "accounts.series_update": route({
    rpc: "accounts_series_update", input: AccSeriesUpdateInput, output: AccSeriesUpdateOutput, command: true,
    args: (i) => ({ p_series_id: i.series_id, p_expected_version: i.expected_version, p_action: i.action }),
  }),
  "accounts.reconciliation": route({
    rpc: "accounts_reconciliation", input: AccReconciliationInput, output: AccReconciliationOutput, command: false,
    args: (i) => ({ p_day: i.day }),
  }),
  "accounts.reconcile_save": route({
    rpc: "accounts_reconcile_save", input: AccReconcileSaveInput, output: AccReconcileSaveOutput, command: true,
    args: (i) => ({ p_day: i.day, p_method: i.method, p_source: i.source, p_statement_cents: i.statement_cents }),
  }),
  "accounts.entries": route({
    rpc: "accounts_entries", input: AccEntriesInput, output: AccEntriesOutput, command: false,
    args: (i) => ({ p_month: i.first_day }),
  }),
  "accounts.statement": route({
    rpc: "accounts_statement", input: AccStatementInput, output: AccStatementOutput, command: false,
    args: (i) => ({ p_month: i.first_day }),
  }),
};

export function createFinanceAdvancedHandler(deps: FinanceAdvancedDeps) {
  return createRpcHandler("finance-advanced", FINANCE_ADVANCED_ROUTES, deps);
}
