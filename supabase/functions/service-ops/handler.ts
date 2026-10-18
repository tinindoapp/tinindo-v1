// Edge Function `service-ops` (P15): plano da Tinindo, pedidos de serviço assistido, acesso delegado e a fila da
// operação. Cada operação é uma RPC transacional (ver _shared/http/rpc-handler.ts). O banco decide quem é dono
// e quem é operador; o header de negócio é seleção. A fila da operação é a única rota sem negócio selecionado.
import {
  AccessGrantInput,
  AccessGrantOutput,
  AccessLogInput,
  AccessLogOutput,
  AccessRevokeInput,
  DeliveryReviewInput,
  OpsAssignInput,
  OpsBlockInput,
  OpsDeliverInput,
  OpsDeliverOutput,
  OpsLogWorkInput,
  OpsLogWorkOutput,
  OpsOrderRefInput,
  OpsQueueInput,
  OpsQueueOutput,
  OpsSnapshotOutput,
  OrderCancelInput,
  OrderListInput,
  OrderListOutput,
  OrderOutput,
  OrderRequestInput,
  PlanCurrentInput,
  PlanCurrentOutput,
  PlanSubscribeInput,
} from "../_shared/contracts/index.ts";
import { createRpcHandler, type Route, route, type RpcHandlerDeps } from "../_shared/http/rpc-handler.ts";

export type ServiceOpsDeps = RpcHandlerDeps;

export const SERVICE_OPS_ROUTES: Record<string, Route> = {
  "plan.current": route({
    rpc: "service_plan_current", input: PlanCurrentInput, output: PlanCurrentOutput, command: false, args: () => ({}),
  }),
  "plan.subscribe": route({
    rpc: "service_plan_subscribe", input: PlanSubscribeInput, output: PlanCurrentOutput, command: true,
    args: (i) => ({ p_offering_version_id: i.offering_version_id, p_scope_hash: i.scope_hash }),
  }),
  "order.request": route({
    rpc: "service_order_request", input: OrderRequestInput, output: OrderOutput, command: true,
    args: (i) => ({ p_offering_version_id: i.offering_version_id, p_scope_hash: i.scope_hash, p_notes: i.notes ?? null }),
  }),
  "order.list": route({
    rpc: "service_order_list", input: OrderListInput, output: OrderListOutput, command: false, args: () => ({}),
  }),
  "order.cancel": route({
    rpc: "service_order_cancel", input: OrderCancelInput, output: OrderOutput, command: true,
    args: (i) => ({ p_order_id: i.order_id, p_expected_version: i.expected_version }),
  }),
  "order.review_delivery": route({
    rpc: "service_delivery_review", input: DeliveryReviewInput, output: OrderOutput, command: true,
    args: (i) => ({ p_order_id: i.order_id, p_deliverable_id: i.deliverable_id, p_decision: i.decision, p_note: i.note ?? null }),
  }),
  "access.grant": route({
    rpc: "service_access_grant", input: AccessGrantInput, output: AccessGrantOutput, command: true,
    args: (i) => ({ p_order_id: i.order_id, p_scopes: i.scopes, p_expires_at: i.expires_at, p_justification: i.justification }),
  }),
  "access.revoke": route({
    rpc: "service_access_revoke", input: AccessRevokeInput, output: AccessGrantOutput, command: true,
    args: (i) => ({ p_grant_id: i.grant_id }),
  }),
  "access.log": route({
    rpc: "service_access_log", input: AccessLogInput, output: AccessLogOutput, command: false, args: () => ({}),
  }),
  "ops.queue": route({
    rpc: "service_ops_queue", input: OpsQueueInput, output: OpsQueueOutput, command: false, tenant: false, args: () => ({}),
  }),
  "ops.assign": route({
    rpc: "service_ops_assign", input: OpsAssignInput, output: OrderOutput, command: true,
    args: (i) => ({ p_order_id: i.order_id, p_assignee_user_id: i.assignee_user_id, p_due_at: i.due_at ?? null }),
  }),
  "ops.start": route({
    rpc: "service_ops_start", input: OpsOrderRefInput, output: OrderOutput, command: true,
    args: (i) => ({ p_order_id: i.order_id }),
  }),
  "ops.log_work": route({
    rpc: "service_ops_log_work", input: OpsLogWorkInput, output: OpsLogWorkOutput, command: true,
    args: (i) => ({ p_order_id: i.order_id, p_minutes: i.minutes, p_kind: i.kind, p_reprocess: i.reprocess, p_note: i.note ?? null }),
  }),
  "ops.deliver": route({
    rpc: "service_ops_deliver", input: OpsDeliverInput, output: OpsDeliverOutput, command: true,
    args: (i) => ({ p_order_id: i.order_id, p_title: i.title, p_evidence: i.evidence }),
  }),
  "ops.block": route({
    rpc: "service_ops_block", input: OpsBlockInput, output: OrderOutput, command: true,
    args: (i) => ({ p_order_id: i.order_id, p_reason: i.reason }),
  }),
  "ops.snapshot": route({
    rpc: "service_ops_snapshot", input: OpsOrderRefInput, output: OpsSnapshotOutput, command: false,
    args: (i) => ({ p_order_id: i.order_id }),
  }),
};

export const createServiceOpsHandler = (deps: ServiceOpsDeps) => createRpcHandler("service-ops", SERVICE_OPS_ROUTES, deps);
