// Identidade do negócio, clientes e catálogo do prestador (P01/P02).
// Vocabulário: `ProviderService` é o serviço que o profissional vende ao cliente dele;
// oferta vendida pela Tinindo ao profissional é outro objeto (doc15, fase 2).
import { z } from "zod";
import {
  BasisPoints,
  Cents,
  IsoDateTime,
  PhoneE164,
  TimeZone,
  Uuid,
  Version,
} from "./common.ts";
import { Profession, TenantStatus } from "./context.ts";

export const Tenant = z.object({
  id: Uuid,
  name: z.string().min(1).max(120),
  profession: Profession,
  timezone: TimeZone,
  currency: z.literal("BRL"),
  status: TenantStatus,
  version: Version,
});
export type Tenant = z.infer<typeof Tenant>;

export const BusinessCreateInput = z.object({
  name: z.string().trim().min(1).max(120),
  profession: Profession,
  timezone: TimeZone.default("America/Sao_Paulo"),
  /** IDs de versões de política/termos aceitos; texto vive fora do contrato. */
  accepted_policy_versions: z.array(z.string().min(1).max(40)).min(1),
});
export const BusinessCreateOutput = z.object({
  tenant: Tenant,
  resource_id: Uuid,
});

export const Customer = z.object({
  id: Uuid,
  tenant_id: Uuid,
  name: z.string().min(1).max(120),
  phone: PhoneE164.nullable(),
  email: z.email().nullable(),
  archived_at: IsoDateTime.nullable(),
  version: Version,
});
export type Customer = z.infer<typeof Customer>;

export const CustomerUpsertInput = z.object({
  /** Ausente = criação. Presente exige expected_version. */
  customer_id: Uuid.optional(),
  expected_version: Version.optional(),
  name: z.string().trim().min(1).max(120),
  phone: PhoneE164.nullable().default(null),
  email: z.email().nullable().default(null),
}).refine((v) => (v.customer_id === undefined) === (v.expected_version === undefined), {
  message: "customer_id e expected_version andam juntos",
  path: ["expected_version"],
});
export const CustomerUpsertOutput = z.object({
  customer: Customer,
  /** Possíveis duplicados no MESMO tenant. Nunca merge automático. */
  possible_duplicates: z.array(Uuid).max(10),
});

export const ProviderService = z.object({
  id: Uuid,
  tenant_id: Uuid,
  name: z.string().min(1).max(120),
  duration_min: z.int().min(5).max(24 * 60),
  buffer_before_min: z.int().min(0).max(240),
  buffer_after_min: z.int().min(0).max(240),
  base_price_cents: Cents,
  min_price_cents: Cents,
  /** Custo estimado; null = desconhecido (piso só manual). */
  estimated_cost_cents: Cents.nullable(),
  fee_bps: BasisPoints.nullable(),
  active: z.boolean(),
  version: Version,
}).refine((s) => s.min_price_cents <= s.base_price_cents, {
  message: "piso não pode exceder o preço base",
  path: ["min_price_cents"],
});
export type ProviderService = z.infer<typeof ProviderService>;

export const ServiceSaveInput = z.object({
  service_id: Uuid.optional(),
  expected_version: Version.optional(),
  name: z.string().trim().min(1).max(120),
  duration_min: z.int().min(5).max(24 * 60),
  buffer_before_min: z.int().min(0).max(240).default(0),
  buffer_after_min: z.int().min(0).max(240).default(0),
  base_price_cents: Cents,
  min_price_cents: Cents,
  estimated_cost_cents: Cents.nullable().default(null),
  fee_bps: BasisPoints.nullable().default(null),
  active: z.boolean().default(true),
}).refine((s) => s.min_price_cents <= s.base_price_cents, {
  message: "piso não pode exceder o preço base",
  path: ["min_price_cents"],
});
export const ServiceSaveOutput = z.object({ service: ProviderService });
