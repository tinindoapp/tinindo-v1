// Fiscal seletivo (P16). Aditivos ao v1; ver ADR-0026.
// NFS-e num caso elegível (MEI, padrão nacional) por provedor fiscal atrás de porta; representação autorizada pelo
// dono (hash dos termos), credencial no provedor (status informado por ele); homologação antes de produção; emitir
// não confirma pagamento; pasta do mês para o contador. O documento do tomador só sai mascarado.
import { z } from "zod";
import { IsoDateTime, Uuid } from "./common.ts";

const Hash = z.string().regex(/^[0-9a-f]{64}$/);
const digits = (v: string) => v.replace(/\D/g, "");
export const FiscalEnvironment = z.enum(["homologacao", "producao"]);
export const FiscalRegime = z.enum(["mei", "simples_nacional", "other"]);
export const FiscalServiceCode = z.enum(["06.01", "06.04"]);
export const EligibilityReason = z.enum(["profile_missing", "regime_not_eligible", "cnpj_invalid", "representation_missing", "credential_invalid"]);
export const FiscalDocumentStatus = z.enum(["submitting", "processing", "authorized", "rejected", "unknown", "cancel_requested", "cancelled"]);

export const FiscalDocument = z.object({
  id: Uuid,
  environment: FiscalEnvironment,
  status: FiscalDocumentStatus,
  receivable_id: Uuid.nullable(),
  customer_id: Uuid.nullable(),
  taker_name: z.string(),
  taker_document_masked: z.string().nullable(),
  service_code: FiscalServiceCode,
  description: z.string(),
  amount_cents: z.int().min(1),
  competence_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  protocol: z.string().nullable(),
  number: z.string().nullable(),
  verification_code: z.string().nullable(),
  pdf_url: z.string().nullable(),
  xml_url: z.string().nullable(),
  reject_reason: z.string().nullable(),
  cancel_reason: z.string().nullable(),
  authorized_at: IsoDateTime.nullable(),
  cancelled_at: IsoDateTime.nullable(),
  created_at: IsoDateTime,
  version: z.int().min(1),
});
export type FiscalDocument = z.infer<typeof FiscalDocument>;

export const FiscalOverview = z.object({
  profile: z.object({
    legal_name: z.string(), cnpj: z.string().regex(/^\d{14}$/), regime: FiscalRegime, municipality_ibge: z.string().regex(/^\d{7}$/),
    service_code: FiscalServiceCode, production_enabled: z.boolean(), version: z.int().min(1),
  }).nullable(),
  terms: z.object({ text: z.string(), hash: Hash }),
  representation: z.object({ id: Uuid, granted_at: IsoDateTime, valid_until: IsoDateTime, current_terms: z.boolean(), active: z.boolean() }).nullable(),
  credential: z.object({ status: z.enum(["missing", "valid", "expired", "invalid"]), valid_until: IsoDateTime.nullable(), environment: FiscalEnvironment, checked_at: IsoDateTime }).nullable(),
  eligibility: z.object({ eligible: z.boolean(), reasons: z.array(EligibilityReason), environment: FiscalEnvironment }),
  homologated: z.boolean(),
  documents: z.array(FiscalDocument).max(50),
  /** Recebíveis sem nota viva, para escolher de qual atendimento emitir. */
  receivables: z.array(z.object({ id: Uuid, description: z.string(), amount_cents: z.int(), status: z.string(), customer_id: Uuid.nullable(),
    customer_name: z.string().nullable(), created_at: IsoDateTime })).max(30),
});
export type FiscalOverview = z.infer<typeof FiscalOverview>;

export const FiscalGetInput = z.object({});
export const FiscalProfileSaveInput = z.object({
  expected_version: z.int().min(0),
  legal_name: z.string().trim().min(2).max(150),
  cnpj: z.string().transform(digits).pipe(z.string().regex(/^\d{14}$/)),
  regime: FiscalRegime,
  municipality_ibge: z.string().trim().regex(/^[1-5]\d{6}$/),
  service_code: FiscalServiceCode,
});
export const FiscalRepresentationInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("grant"), terms_hash: Hash, valid_days: z.int().min(30).max(365).default(365) }),
  z.object({ action: z.literal("revoke") }),
]);
export const FiscalCredentialCheckInput = z.object({});
export const FiscalEmitInput = z.object({
  receivable_id: Uuid.nullable().default(null),
  taker_name: z.string().trim().min(1).max(150),
  taker_document: z.string().transform(digits).pipe(z.string().regex(/^(\d{11}|\d{14})$/)).nullable().default(null),
  description: z.string().trim().min(3).max(500),
  amount_cents: z.int().min(1).max(1_000_000_000),
  competence_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export const FiscalDocumentOutput = z.object({ document: FiscalDocument });
export const FiscalCancelInput = z.object({ document_id: Uuid, expected_version: z.int().min(1), reason: z.string().trim().min(15).max(300) });
export const FiscalFolderInput = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) });
export const FiscalFolderOutput = z.object({
  month: z.string(),
  profile: z.object({ legal_name: z.string(), cnpj: z.string(), regime: FiscalRegime, municipality_ibge: z.string() }).nullable(),
  documents: z.array(FiscalDocument),
  totals: z.object({ authorized_count: z.int(), authorized_cents: z.int(), cancelled_count: z.int(), homologacao_count: z.int() }),
});
export type FiscalFolder = z.infer<typeof FiscalFolderOutput>;
