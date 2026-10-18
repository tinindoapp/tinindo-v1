// Schemas do módulo identity (P01) que AINDA NÃO estão em _shared/contracts.
// business.create usa o contrato v1 congelado. As demais operações são candidatas a entrar no
// registro de contratos por PR do integrador (db/proposals/P01/PROPOSTA_INTEGRADOR.md); até lá,
// este arquivo é a fonte única delas para a função e para src/features/identity.
import { z } from "zod";
import {
  BusinessCreateInput,
  BusinessCreateOutput,
  IsoDateTime,
  Uuid,
  Version,
} from "../_shared/contracts/index.ts";

/** Objetivo principal declarado no onboarding (docs/15: diagnóstico mínimo, sem score). */
export const OnboardingGoal = z.enum([
  "fill_schedule",
  "organize_clients",
  "track_payments",
  "reduce_no_shows",
  "save_admin_time",
]);
export type OnboardingGoal = z.infer<typeof OnboardingGoal>;

export const CancellationNoticeHours = z.int().min(0).max(168);
/** Multa por cancelamento tardio, em basis points do preço combinado. Cobrança é manual (P07). */
export const LateCancellationFeeBps = z.int().min(1).max(10_000);

export const Onboarding = z.object({
  tenant_id: Uuid,
  goal: OnboardingGoal.nullable(),
  cancellation_notice_hours: CancellationNoticeHours.nullable(),
  late_cancellation_fee_bps: LateCancellationFeeBps.nullable(),
  completed_at: IsoDateTime.nullable(),
  version: Version,
});
export type Onboarding = z.infer<typeof Onboarding>;

export const OnboardingSaveInput = z
  .object({
    expected_version: Version,
    goal: OnboardingGoal.nullable().default(null),
    cancellation_notice_hours: CancellationNoticeHours.nullable().default(null),
    late_cancellation_fee_bps: LateCancellationFeeBps.nullable().default(null),
    mark_complete: z.boolean().default(false),
  })
  .refine((v) => !v.mark_complete || (v.goal !== null && v.cancellation_notice_hours !== null), {
    message: "para concluir, informe objetivo e antecedência de cancelamento",
    path: ["mark_complete"],
  });
export type OnboardingSaveInput = z.infer<typeof OnboardingSaveInput>;
export const OnboardingSaveOutput = z.object({ onboarding: Onboarding });

/** Código de vínculo: 256 bits em base64url, sem padding. */
export const LinkCode = z.string().trim().regex(/^[A-Za-z0-9_-]{43}$/, "código de vínculo inválido");

export const CustomerLinkIssueInput = z.object({ customer_id: Uuid });
export const CustomerLinkIssueOutput = z.object({
  invite_id: Uuid,
  customer_id: Uuid,
  expires_at: IsoDateTime,
  /** Só vem na primeira resposta. Na repetição é null: o banco guarda apenas o hash. */
  code: LinkCode.nullable(),
});
export type CustomerLinkIssueOutput = z.infer<typeof CustomerLinkIssueOutput>;

export const CustomerLinkRedeemInput = z.object({ code: LinkCode });
export const CustomerLinkRedeemOutput = z.object({
  link_id: Uuid,
  tenant_id: Uuid,
  tenant_name: z.string().min(1).max(120),
  verified_at: IsoDateTime,
});
export type CustomerLinkRedeemOutput = z.infer<typeof CustomerLinkRedeemOutput>;

export const CustomerLinkRevokeInput = z.object({ link_id: Uuid, expected_version: Version });
export const CustomerLinkRevokeOutput = z.object({
  link_id: Uuid,
  revoked_at: IsoDateTime,
  version: Version,
});

/** Linha de public.my_customer_links(): vínculos ativos do login, sem dados do CRM. */
export const MyCustomerLink = z.object({
  link_id: Uuid,
  tenant_id: Uuid,
  tenant_name: z.string().min(1).max(120),
  verified_at: IsoDateTime,
  version: Version,
});
export type MyCustomerLink = z.infer<typeof MyCustomerLink>;

interface IdentityOperation {
  /** RPC transacional chamada com o JWT do usuário. */
  rpc: string;
  /** true = exige X-Tinindo-Tenant (seleção; o banco autoriza). */
  tenantScoped: boolean;
  input: z.ZodType;
  output: z.ZodType;
}

/** Comandos expostos em POST /functions/v1/identity/<operação>. Todos exigem Idempotency-Key. */
export const IDENTITY_OPERATIONS = {
  "business.create": {
    rpc: "business_create", tenantScoped: false, input: BusinessCreateInput, output: BusinessCreateOutput,
  },
  "onboarding.save": {
    rpc: "onboarding_save", tenantScoped: true, input: OnboardingSaveInput, output: OnboardingSaveOutput,
  },
  "customer_link.issue": {
    rpc: "customer_link_issue", tenantScoped: true, input: CustomerLinkIssueInput, output: CustomerLinkIssueOutput,
  },
  "customer_link.redeem": {
    rpc: "customer_link_redeem", tenantScoped: false, input: CustomerLinkRedeemInput, output: CustomerLinkRedeemOutput,
  },
  "customer_link.revoke": {
    rpc: "customer_link_revoke", tenantScoped: true, input: CustomerLinkRevokeInput, output: CustomerLinkRevokeOutput,
  },
} as const satisfies Record<string, IdentityOperation>;

export type IdentityOperationName = keyof typeof IDENTITY_OPERATIONS;
export const IDENTITY_OPERATION_NAMES = Object.keys(IDENTITY_OPERATIONS) as IdentityOperationName[];
