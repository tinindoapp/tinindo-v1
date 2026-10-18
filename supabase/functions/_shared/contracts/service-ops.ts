// Planos e serviços assistidos (P15). Aditivos ao v1; ver ADR-0014.
// Assinatura e pedido fixam a versão (preço, escopo, franquia). Minutos são medidos com teto. Operador da Tinindo
// só lê dados do negócio com concessão do dono (escopo + prazo), e cada leitura é auditada.
import { z } from "zod";
import { Cents, IsoDateTime, Uuid, Version } from "./common.ts";

const Sha256Hex = z.string().regex(/^[0-9a-f]{64}$/);

export const OfferingVersion = z.object({
  id: Uuid,
  code: z.string(),
  kind: z.enum(["plan", "service"]),
  version_no: z.int().min(1),
  name: z.string(),
  description: z.string(),
  price_cents: Cents,
  billing: z.enum(["monthly", "one_time"]),
  included: z.array(z.string()),
  excluded: z.array(z.string()),
  agent_questions_month: z.int().nullable(),
  assisted_minutes: z.int().nullable(),
  sla_days: z.int().nullable(),
  scope_hash: Sha256Hex,
  published_at: IsoDateTime,
});
export type OfferingVersion = z.infer<typeof OfferingVersion>;

export const PlanCurrentInput = z.object({});
export const PlanCurrentOutput = z.object({
  /** null = sem assinatura registrada (plano Grátis). Registrar assinatura não é pagamento. */
  subscription: z.object({
    id: Uuid, price_cents: Cents, scope_hash: Sha256Hex, started_at: IsoDateTime, billing_source: z.literal("manual"),
  }).nullable(),
  plan: OfferingVersion,
  /** false = existe versão mais nova; a assinatura mantém a versão aceita. */
  plan_is_latest: z.boolean(),
  usage: z.object({ agent_questions_used: z.int().min(0), agent_questions_limit: z.int().min(0), period_start: z.string() }).nullable(),
  catalog: z.array(OfferingVersion),
});
export const PlanSubscribeInput = z.object({ offering_version_id: Uuid, scope_hash: Sha256Hex });

export const ServiceOrderStatus = z.enum(["scope_accepted", "awaiting_access", "in_progress", "client_review", "delivered", "cancelled", "blocked"]);
export type ServiceOrderStatus = z.infer<typeof ServiceOrderStatus>;
export const AccessScope = z.enum(["catalog", "agenda", "customers"]);
export type AccessScope = z.infer<typeof AccessScope>;

export const ServiceOrder = z.object({
  id: Uuid,
  tenant_id: Uuid,
  status: ServiceOrderStatus,
  offering: OfferingVersion,
  scope_hash: Sha256Hex,
  price_cents: Cents,
  minutes_quota: z.int().min(0),
  assignee_user_id: Uuid.nullable(),
  assignee_name: z.string().nullable(),
  due_at: IsoDateTime.nullable(),
  notes: z.string().nullable(),
  blocked_reason: z.string().nullable(),
  created_at: IsoDateTime,
  version: z.int().min(1),
  /** Minutos medidos (work_logs), nunca estimados. */
  minutes_used: z.int().min(0),
  human_minutes: z.int().min(0),
  reprocess_minutes: z.int().min(0),
});
export type ServiceOrder = z.infer<typeof ServiceOrder>;

export const AccessGrant = z.object({
  id: Uuid,
  order_id: Uuid,
  operator_user_id: Uuid,
  operator_name: z.string().nullable(),
  scopes: z.array(AccessScope).min(1),
  justification: z.string(),
  expires_at: IsoDateTime,
  granted_at: IsoDateTime,
  revoked_at: IsoDateTime.nullable(),
  active: z.boolean(),
});
export type AccessGrant = z.infer<typeof AccessGrant>;

export const Deliverable = z.object({
  id: Uuid,
  version_no: z.int().min(1),
  title: z.string(),
  evidence: z.string(),
  delivered_at: IsoDateTime,
  review: z.object({ decision: z.enum(["approved", "changes_requested"]), note: z.string().nullable(), decided_at: IsoDateTime }).nullable(),
});
export const ServiceOrderEvent = z.object({
  from_status: ServiceOrderStatus.nullable(),
  to_status: ServiceOrderStatus,
  note: z.string().nullable(),
  occurred_at: IsoDateTime,
});
export const ServiceOrderDetail = ServiceOrder.extend({
  deliverables: z.array(Deliverable),
  grants: z.array(AccessGrant),
  events: z.array(ServiceOrderEvent).max(20),
});
export type ServiceOrderDetail = z.infer<typeof ServiceOrderDetail>;

export const OrderRequestInput = z.object({ offering_version_id: Uuid, scope_hash: Sha256Hex, notes: z.string().max(500).nullable().optional() });
export const OrderOutput = z.object({ order: ServiceOrder });
export const OrderListInput = z.object({});
export const OrderListOutput = z.object({ orders: z.array(ServiceOrderDetail).max(50) });
export const OrderCancelInput = z.object({ order_id: Uuid, expected_version: Version });
export const DeliveryReviewInput = z.object({
  order_id: Uuid,
  deliverable_id: Uuid,
  decision: z.enum(["approved", "changes_requested"]),
  note: z.string().max(280).nullable().optional(),
});

export const AccessGrantInput = z.object({
  order_id: Uuid,
  scopes: z.array(AccessScope).min(1).max(3),
  /** No máximo 30 dias. */
  expires_at: IsoDateTime,
  justification: z.string().trim().min(1).max(280),
});
export const AccessGrantOutput = z.object({ grant: AccessGrant });
export const AccessRevokeInput = z.object({ grant_id: Uuid });
export const AccessLogInput = z.object({});
export const AccessLogOutput = z.object({
  entries: z.array(z.object({
    action: z.string(),
    actor_name: z.string(),
    object_id: Uuid.nullable(),
    scopes: z.array(AccessScope).nullable(),
    occurred_at: IsoDateTime,
  })).max(100),
});

// ---------------------------------------------------------------------------
// Operação Tinindo (somente operadores ativos)
// ---------------------------------------------------------------------------

export const OpsQueueInput = z.object({});
export const OpsQueueOutput = z.object({
  operator: z.object({ user_id: Uuid, display_name: z.string() }),
  operators: z.array(z.object({ user_id: Uuid, display_name: z.string() })),
  orders: z.array(ServiceOrder.extend({ tenant_name: z.string(), has_access: z.boolean(), access_scopes: z.array(AccessScope) })).max(200),
});
export const OpsAssignInput = z.object({ order_id: Uuid, assignee_user_id: Uuid, due_at: IsoDateTime.nullable().optional() });
export const OpsOrderRefInput = z.object({ order_id: Uuid });
export const OpsLogWorkInput = z.object({
  order_id: Uuid,
  minutes: z.int().min(1).max(480),
  kind: z.enum(["human", "automation"]),
  reprocess: z.boolean().default(false),
  note: z.string().max(280).nullable().optional(),
});
export const OpsLogWorkOutput = z.object({ order: ServiceOrder, work_log_id: Uuid });
export const OpsDeliverInput = z.object({ order_id: Uuid, title: z.string().trim().min(1).max(120), evidence: z.string().trim().min(1).max(500) });
export const OpsDeliverOutput = z.object({ order: ServiceOrder, deliverable_id: Uuid });
export const OpsBlockInput = z.object({ order_id: Uuid, reason: z.string().trim().min(1).max(280) });
/** Leitura com acesso delegado: só os escopos concedidos; sem telefone, e-mail ou observações. Auditada. */
export const OpsSnapshotOutput = z.object({
  scopes: z.array(AccessScope),
  expires_at: IsoDateTime,
  tenant_name: z.string(),
  catalog: z.array(z.object({ name: z.string(), duration_min: z.int(), base_price_cents: Cents, active: z.boolean() })).nullable(),
  agenda: z.array(z.object({ starts_at: IsoDateTime, ends_at: IsoDateTime, status: z.string(), service_name: z.string().nullable() })).nullable(),
  customers: z.object({ count: z.int().min(0), names: z.array(z.string()) }).nullable(),
});
