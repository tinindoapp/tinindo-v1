// Portas do módulo Conta. A implementação padrão fala com o Supabase Auth, a Edge Function
// `identity` e leituras com RLS; os testes injetam fakes pelo IdentityServicesProvider.
import { createContext, type ReactNode, useContext, useMemo } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { type BusinessCreateInput, BusinessCreateOutput, Profession } from "@contracts";
import { tenantA } from "@contracts/fixtures.ts";
import type { z } from "zod";
import {
  CustomerLinkRedeemOutput,
  CustomerLinkRevokeOutput,
  MyCustomerLink,
  Onboarding,
  OnboardingSaveOutput,
  type OnboardingSaveInput,
} from "@contracts";
import { appEnv } from "../../app/env.ts";
import { useSession } from "../../app/session.tsx";
import { createApiClient } from "../../lib/api/client.ts";
import { supabase } from "../../lib/supabase.ts";

export type BusinessDraft = z.input<typeof BusinessCreateInput>;
export interface BusinessSummary {
  name: string;
  profession: Profession;
}

export interface IdentityServices {
  /** false = demonstração offline: nada é gravado, formulários ficam desabilitados. */
  online: boolean;
  createBusiness(input: BusinessDraft, idempotencyKey: string): Promise<z.infer<typeof BusinessCreateOutput>>;
  /** Nome e profissão do negócio selecionado (RLS: só membros leem). */
  loadBusiness(tenantId: string): Promise<BusinessSummary | null>;
  loadOnboarding(tenantId: string): Promise<Onboarding | null>;
  saveOnboarding(
    tenantId: string,
    input: z.input<typeof OnboardingSaveInput>,
    idempotencyKey: string,
  ): Promise<Onboarding>;
  loadMyLinks(): Promise<MyCustomerLink[]>;
  redeemLink(code: string, idempotencyKey: string): Promise<z.infer<typeof CustomerLinkRedeemOutput>>;
  revokeLink(tenantId: string, linkId: string, expectedVersion: number, idempotencyKey: string): Promise<void>;
  signUp(email: string, password: string): Promise<{ needsConfirmation: boolean }>;
  requestPasswordReset(email: string): Promise<void>;
  updatePassword(password: string): Promise<void>;
  /** Renova a sessão: o SessionProvider recarrega os negócios do login. */
  refreshSession(): Promise<void>;
}

/** Erro amigável vindo do Supabase Auth (mensagens próprias; não ecoa texto do servidor). */
export class AuthFlowError extends Error {
  constructor(readonly kind: "weak_password" | "rate_limited" | "failed") {
    super(kind);
    this.name = "AuthFlowError";
  }
}

function authError(error: { status?: number; code?: string } | null): AuthFlowError | null {
  if (!error) return null;
  if (error.code === "weak_password") return new AuthFlowError("weak_password");
  if (error.status === 429 || error.code === "over_email_send_rate_limit") return new AuthFlowError("rate_limited");
  return new AuthFlowError("failed");
}

const appUrl = (path: string) => `${window.location.origin}${path}`;

const offline = (): never => {
  throw new AuthFlowError("failed");
};

export function createDefaultServices(
  client: SupabaseClient | null,
  getAccessToken: () => Promise<string | null>,
): IdentityServices {
  if (!client || !appEnv.supabase) {
    return {
      online: false,
      createBusiness: offline,
      // Demonstração: só a fixture do tenant A, somente leitura.
      loadBusiness: async (id) => (id === tenantA.id ? { name: tenantA.name, profession: tenantA.profession } : null),
      loadOnboarding: async (id) =>
        id === tenantA.id
          ? {
              tenant_id: id, goal: null, cancellation_notice_hours: null, late_cancellation_fee_bps: null,
              completed_at: null, version: 1,
            }
          : null,
      saveOnboarding: offline,
      loadMyLinks: async () => [],
      redeemLink: offline,
      revokeLink: offline,
      signUp: offline,
      requestPasswordReset: offline,
      updatePassword: offline,
      refreshSession: async () => {},
    };
  }
  const call = createApiClient({
    baseUrl: appEnv.supabase.url,
    publishableKey: appEnv.supabase.publishableKey,
    getAccessToken,
  });
  return {
    online: true,
    async createBusiness(input, idempotencyKey) {
      const { data } = await call("/identity/business.create", BusinessCreateOutput, {
        method: "POST", body: input, idempotencyKey,
      });
      return data;
    },
    async loadBusiness(tenantId) {
      const { data, error } = await client.from("tenants").select("name, profession").eq("id", tenantId).maybeSingle();
      if (error) throw new AuthFlowError("failed");
      return data ? { name: String(data.name), profession: Profession.parse(data.profession) } : null;
    },
    async loadOnboarding(tenantId) {
      const { data, error } = await client
        .from("tenant_onboarding")
        .select("tenant_id, goal, cancellation_notice_hours, late_cancellation_fee_bps, completed_at, version")
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (error) throw new AuthFlowError("failed");
      return data ? Onboarding.parse(data) : null;
    },
    async saveOnboarding(tenantId, input, idempotencyKey) {
      const { data } = await call("/identity/onboarding.save", OnboardingSaveOutput, {
        method: "POST", tenantId, body: input, idempotencyKey,
      });
      return data.onboarding;
    },
    async loadMyLinks() {
      const { data, error } = await client.rpc("my_customer_links");
      if (error) throw new AuthFlowError("failed");
      return MyCustomerLink.array().max(100).parse(data ?? []);
    },
    async redeemLink(code, idempotencyKey) {
      const { data } = await call("/identity/customer_link.redeem", CustomerLinkRedeemOutput, {
        method: "POST", body: { code }, idempotencyKey,
      });
      return data;
    },
    async revokeLink(tenantId, linkId, expectedVersion, idempotencyKey) {
      await call("/identity/customer_link.revoke", CustomerLinkRevokeOutput, {
        method: "POST", tenantId, body: { link_id: linkId, expected_version: expectedVersion }, idempotencyKey,
      });
    },
    async signUp(email, password) {
      const { data, error } = await client.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: appUrl("/app/conta/novo-negocio") },
      });
      const failure = authError(error);
      if (failure) throw failure;
      return { needsConfirmation: !data.session };
    },
    async requestPasswordReset(email) {
      const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: appUrl("/app/conta/nova-senha") });
      // Só limite de envio é exposto. Outros erros (inclusive e-mail inexistente) ficam neutros.
      if (error && authError(error)?.kind === "rate_limited") throw new AuthFlowError("rate_limited");
    },
    async updatePassword(password) {
      const failure = authError((await client.auth.updateUser({ password })).error);
      if (failure) throw failure;
    },
    async refreshSession() {
      await client.auth.refreshSession();
    },
  };
}

const ServicesContext = createContext<IdentityServices | null>(null);

export function IdentityServicesProvider({ value, children }: { value?: IdentityServices; children: ReactNode }) {
  const { getAccessToken } = useSession();
  const services = useMemo(() => value ?? createDefaultServices(supabase, getAccessToken), [value, getAccessToken]);
  return <ServicesContext.Provider value={services}>{children}</ServicesContext.Provider>;
}

export function useIdentityServices(): IdentityServices {
  const ctx = useContext(ServicesContext);
  if (!ctx) throw new Error("useIdentityServices fora do IdentityServicesProvider");
  return ctx;
}
