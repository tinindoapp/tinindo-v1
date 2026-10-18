// Schemas do módulo CRM (P02) que estendem os contratos v1 sem alterá-los.
// `customer.upsert` e `service.save` usam os schemas congelados de _shared/contracts; aqui ficam
// apenas o campo opcional `declared_source` e as rotas locais do módulo (listar, arquivar,
// importar). Proposta de promoção para _shared/contracts: db/proposals/P02/NOTAS.md.
// TypeScript puro + zod: usado pela Edge Function (Deno) e pela tela (Vite).
import { z } from "zod";
import {
  Customer,
  CustomerUpsertInput,
  PAGE_LIMIT_DEFAULT,
  PAGE_LIMIT_MAX,
  ProviderService,
  Uuid,
  Version,
} from "../_shared/contracts/index.ts";

/** Origem do contato DECLARADA pelo profissional. Não é verificada nem é atribuição de marketing. */
export const DeclaredSource = z.enum([
  "referral",
  "instagram",
  "whatsapp",
  "google",
  "walk_in",
  "condominium",
  "returning",
  "other",
]);
export type DeclaredSource = z.infer<typeof DeclaredSource>;

export const CrmCustomer = Customer.extend({ declared_source: DeclaredSource.nullable() });
export type CrmCustomer = z.infer<typeof CrmCustomer>;

export const CrmCustomerUpsertInput = CustomerUpsertInput.safeExtend({
  declared_source: DeclaredSource.nullable().default(null),
});
export type CrmCustomerUpsertInput = z.input<typeof CrmCustomerUpsertInput>;

export const CrmCustomerUpsertOutput = z.object({
  customer: CrmCustomer,
  /** Possíveis duplicados no MESMO tenant. Nunca merge automático. */
  possible_duplicates: z.array(Uuid).max(10),
});
export type CrmCustomerUpsertOutput = z.infer<typeof CrmCustomerUpsertOutput>;

export const CustomerArchiveInput = z.object({
  customer_id: Uuid,
  expected_version: Version,
  /** true arquiva; false desarquiva. Nunca apaga (reservas e pagamentos referenciam). */
  archived: z.boolean(),
});
export const CustomerArchiveOutput = z.object({ customer: CrmCustomer });

const Limit = z.coerce.number().int().min(1).max(PAGE_LIMIT_MAX).default(PAGE_LIMIT_DEFAULT);
const Flag = z.enum(["true", "false"]).default("false").transform((v) => v === "true");
const Cursor = z.string().min(1).max(512).optional();

/** Query string de GET /crm/customers. */
export const CustomerListQuery = z.object({
  q: z.string().trim().max(120).optional(),
  include_archived: Flag,
  cursor: Cursor,
  limit: Limit,
});
export const CustomerListOutput = z.object({
  items: z.array(CrmCustomer).max(PAGE_LIMIT_MAX),
  next_cursor: z.string().nullable(),
});
export type CustomerListOutput = z.infer<typeof CustomerListOutput>;

/** Query string de GET /crm/services. */
export const ServiceListQuery = z.object({
  include_inactive: Flag,
  cursor: Cursor,
  limit: Limit,
});
export const ServiceListOutput = z.object({
  items: z.array(ProviderService).max(PAGE_LIMIT_MAX),
  next_cursor: z.string().nullable(),
});
export type ServiceListOutput = z.infer<typeof ServiceListOutput>;

// ---------------------------------------------------------------------------
// Importação CSV mínima. O navegador faz o parse; o servidor revalida cada linha.
// Linha inválida não derruba o lote: volta em `rejected` com linha, campo e motivo.
// ---------------------------------------------------------------------------

export const IMPORT_MAX_ROWS = 500;

/** Linha já interpretada pelo navegador. Strings livres: a validação de formato é por linha. */
export const ImportRow = z.object({
  /** Número da linha no arquivo (cabeçalho = 1). */
  line: z.int().min(1).max(1_000_000),
  name: z.string().max(500),
  phone: z.string().max(500).nullable(),
  email: z.string().max(500).nullable(),
  declared_source: z.string().max(40).nullable().default(null),
  /** Decisão do profissional quando há possível duplicado. Padrão: pular. */
  on_duplicate: z.enum(["skip", "create"]).default("skip"),
});
export type ImportRow = z.input<typeof ImportRow>;

export const ImportPreviewInput = z.object({
  rows: z.array(ImportRow.pick({ line: true, name: true, phone: true, email: true })).min(1).max(IMPORT_MAX_ROWS),
});
export const MatchReason = z.enum(["phone", "email", "name"]);
export const ImportPreviewOutput = z.object({
  rows: z.array(
    z.object({
      line: z.int(),
      matches: z.array(z.object({ customer_id: Uuid, name: z.string(), reasons: z.array(MatchReason) })).max(10),
    }),
  ),
});
export type ImportPreviewOutput = z.infer<typeof ImportPreviewOutput>;

export const ImportInput = z.object({ rows: z.array(ImportRow).min(1).max(IMPORT_MAX_ROWS) });
export type ImportInput = z.input<typeof ImportInput>;

export const RejectReason = z.enum([
  "NAME_REQUIRED",
  "NAME_TOO_LONG",
  "PHONE_INVALID",
  "EMAIL_INVALID",
  "SOURCE_INVALID",
  "DUPLICATE_IN_FILE",
]);
export type RejectReason = z.infer<typeof RejectReason>;

export const ImportOutput = z.object({
  created: z.array(z.object({ line: z.int(), customer_id: Uuid, possible_duplicates: z.array(Uuid) })),
  skipped: z.array(z.object({ line: z.int(), duplicate_of: z.array(Uuid).min(1) })),
  rejected: z.array(z.object({ line: z.int(), field: z.string(), reason: RejectReason })),
});
export type ImportOutput = z.infer<typeof ImportOutput>;

/** Rotas da função `crm` (POST /functions/v1/crm/<rota>). */
export const CRM_ROUTES = {
  listCustomers: "customers",
  listServices: "services",
  upsertCustomer: "customer.upsert",
  archiveCustomer: "customer.archive",
  importPreview: "customer.import_preview",
  importCustomers: "customer.import",
  saveService: "service.save",
} as const;
