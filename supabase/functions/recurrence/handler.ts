// Edge Function `recurrence` (P20): planos recorrentes do profissional. Cada operação é uma RPC transacional do
// dono (ver _shared/http/rpc-handler.ts). A renovação acontece no worker (`jobs`), nunca aqui.
import {
  RecurrenceCancelInput,
  RecurrenceCyclesInput,
  RecurrenceCyclesOutput,
  RecurrenceListInput,
  RecurrenceListOutput,
  RecurrencePlanListInput,
  RecurrencePlanListOutput,
  RecurrencePlanOutput,
  RecurrencePlanSaveInput,
  RecurrenceResumeInput,
  RecurrenceSubscribeInput,
  RecurrenceSubscriptionOutput,
} from "../_shared/contracts/index.ts";
import { createRpcHandler, type Route, route, type RpcHandlerDeps } from "../_shared/http/rpc-handler.ts";

export type RecurrenceDeps = RpcHandlerDeps;

export const RECURRENCE_ROUTES: Record<string, Route> = {
  "recurrence.plan_save": route({
    rpc: "recurrence_plan_save", input: RecurrencePlanSaveInput, output: RecurrencePlanOutput, command: true,
    args: (i) => ({ p_plan_id: i.plan_id, p_expected_version: i.expected_version, p_service_id: i.service_id, p_name: i.name,
      p_sessions_per_cycle: i.sessions_per_cycle, p_cycle_days: i.cycle_days, p_price_cents: i.price_cents, p_active: i.active }),
  }),
  "recurrence.plans": route({ rpc: "recurrence_plan_list", input: RecurrencePlanListInput, output: RecurrencePlanListOutput, command: false, args: () => ({}) }),
  "recurrence.subscribe": route({
    rpc: "recurrence_subscribe", input: RecurrenceSubscribeInput, output: RecurrenceSubscriptionOutput, command: true,
    args: (i) => ({ p_plan_id: i.plan_id, p_customer_id: i.customer_id }),
  }),
  "recurrence.cancel": route({
    rpc: "recurrence_cancel", input: RecurrenceCancelInput, output: RecurrenceSubscriptionOutput, command: true,
    args: (i) => ({ p_subscription_id: i.subscription_id, p_expected_version: i.expected_version, p_at_period_end: i.at_period_end, p_reason: i.reason }),
  }),
  "recurrence.resume": route({
    rpc: "recurrence_resume", input: RecurrenceResumeInput, output: RecurrenceSubscriptionOutput, command: true,
    args: (i) => ({ p_subscription_id: i.subscription_id, p_expected_version: i.expected_version }),
  }),
  "recurrence.subscriptions": route({ rpc: "recurrence_list", input: RecurrenceListInput, output: RecurrenceListOutput, command: false, args: () => ({}) }),
  "recurrence.cycles": route({ rpc: "recurrence_cycles_list", input: RecurrenceCyclesInput, output: RecurrenceCyclesOutput, command: false, args: (i) => ({ p_subscription_id: i.subscription_id }) }),
};

export function createRecurrenceHandler(deps: RecurrenceDeps) {
  return createRpcHandler("recurrence", RECURRENCE_ROUTES, deps);
}
