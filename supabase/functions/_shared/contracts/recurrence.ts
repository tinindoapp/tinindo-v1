// Planos recorrentes do profissional (P20). Aditivos ao v1; ver ADR-0020.
// Termos aceitos congelados na adesão; cada ciclo = pacote de sessões (P07) + recebível; renovação pelo worker.
// Cancelar preserva o aceito e o saldo do ciclo corrente. Cobrança do ciclo: pelo P14 ou manual, nunca automática.
import { z } from "zod";
import { Cents, IsoDateTime, Uuid } from "./common.ts";
import { PackageBalance, Receivable } from "./finance.ts";

export const CycleDays = z.union([z.literal(7), z.literal(14), z.literal(30)]);

export const RecurrencePlan = z.object({
  id: Uuid,
  service_id: Uuid,
  service_name: z.string().nullable(),
  name: z.string().min(1).max(80),
  sessions_per_cycle: z.int().min(1).max(31),
  cycle_days: CycleDays,
  price_cents: Cents.min(1),
  active: z.boolean(),
  /** Assinaturas ativas deste plano. */
  subscribers: z.int().min(0),
  created_at: IsoDateTime,
  version: z.int().min(1),
});
export type RecurrencePlan = z.infer<typeof RecurrencePlan>;

export const RecurrencePlanSaveInput = z.object({
  /** null = criar. */
  plan_id: Uuid.nullable().default(null),
  expected_version: z.int().min(1).nullable().default(null),
  service_id: Uuid,
  name: z.string().trim().min(1).max(80),
  sessions_per_cycle: z.int().min(1).max(31),
  cycle_days: CycleDays.default(30),
  price_cents: Cents.min(1),
  active: z.boolean().default(true),
});
export const RecurrencePlanOutput = z.object({ plan: RecurrencePlan });
export const RecurrencePlanListInput = z.object({});
export const RecurrencePlanListOutput = z.object({ plans: z.array(RecurrencePlan).max(100) });

/** Termos aceitos, congelados na adesão. */
export const RecurrenceTerms = z.object({
  plan_name: z.string(),
  service_id: Uuid,
  service_name: z.string().nullable(),
  sessions_per_cycle: z.int().min(1).max(31),
  cycle_days: CycleDays,
  price_cents: Cents.min(1),
});
export const RecurrenceCycle = z.object({
  id: Uuid,
  cycle_no: z.int().min(1),
  starts_at: IsoDateTime,
  ends_at: IsoDateTime,
  package: PackageBalance,
  receivable: Receivable,
});
export type RecurrenceCycle = z.infer<typeof RecurrenceCycle>;
export const RecurrenceSubscription = z.object({
  id: Uuid,
  plan_id: Uuid,
  customer_id: Uuid,
  customer_name: z.string().nullable(),
  status: z.enum(["active", "cancelled"]),
  terms: RecurrenceTerms,
  terms_hash: z.string().regex(/^[0-9a-f]{64}$/),
  accepted_at: IsoDateTime,
  accepted_source: z.literal("owner_declared"),
  started_at: IsoDateTime,
  next_renewal_at: IsoDateTime.nullable(),
  cancel_at_period_end: z.boolean(),
  cancelled_at: IsoDateTime.nullable(),
  cancel_reason: z.string().nullable(),
  cycles_count: z.int().min(0),
  current_cycle: RecurrenceCycle.nullable(),
  version: z.int().min(1),
});
export type RecurrenceSubscription = z.infer<typeof RecurrenceSubscription>;

export const RecurrenceSubscribeInput = z.object({ plan_id: Uuid, customer_id: Uuid });
export const RecurrenceSubscriptionOutput = z.object({ subscription: RecurrenceSubscription });
export const RecurrenceCancelInput = z.object({
  subscription_id: Uuid,
  expected_version: z.int().min(1),
  /** true (padrão) = segue até o fim do ciclo e não renova; false = encerra agora (saldo do ciclo preservado). */
  at_period_end: z.boolean().default(true),
  reason: z.string().trim().max(280).nullable().default(null),
});
export const RecurrenceResumeInput = z.object({ subscription_id: Uuid, expected_version: z.int().min(1) });
export const RecurrenceListInput = z.object({});
export const RecurrenceListOutput = z.object({ subscriptions: z.array(RecurrenceSubscription).max(200) });
export const RecurrenceCyclesInput = z.object({ subscription_id: Uuid });
export const RecurrenceCyclesOutput = z.object({ cycles: z.array(RecurrenceCycle).max(200) });
