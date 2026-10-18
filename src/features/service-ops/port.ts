// Portas do módulo Plano e serviços (P15). Demonstração: emulação na aba; servidor: Edge Function `service-ops`.
import type {
  AccessGrant,
  AccessLogOutput,
  AccessScope,
  OfferingVersion,
  OpsQueueOutput,
  OpsSnapshotOutput,
  PlanCurrentOutput,
  ServiceOrder,
  ServiceOrderDetail,
} from "@contracts";
import type { z } from "zod";

export type PlanCurrent = z.infer<typeof PlanCurrentOutput>;
export type AccessLog = z.infer<typeof AccessLogOutput>["entries"];
export type OpsQueue = z.infer<typeof OpsQueueOutput>;
export type QueueOrder = OpsQueue["orders"][number];
export type Snapshot = z.infer<typeof OpsSnapshotOutput>;

/** Visão do dono do negócio. */
export interface ServiceOpsPort {
  readonly kind: "demo" | "server";
  now(): Date;
  timezone(): Promise<string>;
  plan(): Promise<PlanCurrent>;
  subscribe(version: OfferingVersion, key: string): Promise<PlanCurrent>;
  orders(): Promise<ServiceOrderDetail[]>;
  request(version: OfferingVersion, notes: string | null, key: string): Promise<ServiceOrder>;
  cancel(order: ServiceOrder, key: string): Promise<ServiceOrder>;
  review(order: ServiceOrder, deliverableId: string, decision: "approved" | "changes_requested", note: string | null, key: string): Promise<ServiceOrder>;
  grant(order: ServiceOrder, scopes: AccessScope[], expiresAt: string, justification: string, key: string): Promise<AccessGrant>;
  revoke(grantId: string, key: string): Promise<AccessGrant>;
  accessLog(): Promise<AccessLog>;
}

/** Visão da equipe Tinindo (somente operadores; o banco decide). */
export interface OpsPort {
  readonly kind: "demo" | "server";
  queue(): Promise<OpsQueue>;
  assign(order: QueueOrder, assigneeUserId: string, key: string): Promise<ServiceOrder>;
  start(order: QueueOrder, key: string): Promise<ServiceOrder>;
  logWork(order: QueueOrder, minutes: number, kind: "human" | "automation", reprocess: boolean, note: string | null, key: string): Promise<ServiceOrder>;
  deliver(order: QueueOrder, title: string, evidence: string, key: string): Promise<ServiceOrder>;
  block(order: QueueOrder, reason: string, key: string): Promise<ServiceOrder>;
  snapshot(order: QueueOrder): Promise<Snapshot>;
}

export const newKey = () => crypto.randomUUID();
