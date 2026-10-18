// Portas reais de Plano e serviços: Edge Function `service-ops` (+ `context` para o fuso).
import {
  AccessGrantOutput,
  AccessLogOutput,
  ContextResponse,
  OpsDeliverOutput,
  OpsLogWorkOutput,
  OpsQueueOutput,
  OpsSnapshotOutput,
  OrderListOutput,
  OrderOutput,
  PlanCurrentOutput,
} from "@contracts";
import type { createApiClient } from "../../lib/api/client.ts";
import type { OpsPort, ServiceOpsPort } from "./port.ts";

type Call = ReturnType<typeof createApiClient>;
const op = (name: string) => `/service-ops/${name}`;

export function createServerPort(call: Call, tenantId: string): ServiceOpsPort {
  const post = (body: unknown, idempotencyKey?: string) => ({ method: "POST" as const, tenantId, body, idempotencyKey });
  return {
    kind: "server",
    now: () => new Date(),
    async timezone() {
      return (await call("/context", ContextResponse, { tenantId })).data.timezone;
    },
    async plan() {
      return (await call(op("plan.current"), PlanCurrentOutput, post({}))).data;
    },
    async subscribe(v, key) {
      return (await call(op("plan.subscribe"), PlanCurrentOutput, post({ offering_version_id: v.id, scope_hash: v.scope_hash }, key))).data;
    },
    async orders() {
      return (await call(op("order.list"), OrderListOutput, post({}))).data.orders;
    },
    async request(v, notes, key) {
      return (await call(op("order.request"), OrderOutput, post({ offering_version_id: v.id, scope_hash: v.scope_hash, notes }, key))).data.order;
    },
    async cancel(o, key) {
      return (await call(op("order.cancel"), OrderOutput, post({ order_id: o.id, expected_version: o.version }, key))).data.order;
    },
    async review(o, deliverableId, decision, note, key) {
      return (await call(op("order.review_delivery"), OrderOutput, post({ order_id: o.id, deliverable_id: deliverableId, decision, note }, key))).data.order;
    },
    async grant(o, scopes, expiresAt, justification, key) {
      return (await call(op("access.grant"), AccessGrantOutput, post({ order_id: o.id, scopes, expires_at: expiresAt, justification }, key))).data.grant;
    },
    async revoke(grantId, key) {
      return (await call(op("access.revoke"), AccessGrantOutput, post({ grant_id: grantId }, key))).data.grant;
    },
    async accessLog() {
      return (await call(op("access.log"), AccessLogOutput, post({}))).data.entries;
    },
  };
}

/** Operação: o negócio do pedido vai no header (seleção); o banco confere operador, responsável e concessão. */
export function createServerOpsPort(call: Call): OpsPort {
  const post = (tenantId: string, body: unknown, idempotencyKey?: string) => ({ method: "POST" as const, tenantId, body, idempotencyKey });
  return {
    kind: "server",
    async queue() {
      return (await call(op("ops.queue"), OpsQueueOutput, { method: "POST", body: {} })).data;
    },
    async assign(o, assignee, key) {
      return (await call(op("ops.assign"), OrderOutput, post(o.tenant_id, { order_id: o.id, assignee_user_id: assignee }, key))).data.order;
    },
    async start(o, key) {
      return (await call(op("ops.start"), OrderOutput, post(o.tenant_id, { order_id: o.id }, key))).data.order;
    },
    async logWork(o, minutes, kind, reprocess, note, key) {
      return (await call(op("ops.log_work"), OpsLogWorkOutput, post(o.tenant_id, { order_id: o.id, minutes, kind, reprocess, note }, key))).data.order;
    },
    async deliver(o, title, evidence, key) {
      return (await call(op("ops.deliver"), OpsDeliverOutput, post(o.tenant_id, { order_id: o.id, title, evidence }, key))).data.order;
    },
    async block(o, reason, key) {
      return (await call(op("ops.block"), OrderOutput, post(o.tenant_id, { order_id: o.id, reason }, key))).data.order;
    },
    async snapshot(o) {
      return (await call(op("ops.snapshot"), OpsSnapshotOutput, post(o.tenant_id, { order_id: o.id }))).data;
    },
  };
}
