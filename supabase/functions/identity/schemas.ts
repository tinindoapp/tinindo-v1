// Mapa operação → RPC do módulo identity (P01). Os schemas são contrato v1 em _shared/contracts
// (identity.ts); este arquivo os reexporta para a função e para os testes do módulo.
import type { z } from "zod";
import {
  BusinessCreateInput,
  BusinessCreateOutput,
  CustomerLinkIssueInput,
  CustomerLinkIssueOutput,
  CustomerLinkRedeemInput,
  CustomerLinkRedeemOutput,
  CustomerLinkRevokeInput,
  CustomerLinkRevokeOutput,
  OnboardingSaveInput,
  OnboardingSaveOutput,
} from "../_shared/contracts/index.ts";

export * from "../_shared/contracts/identity.ts";

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
