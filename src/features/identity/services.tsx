// Portas do módulo Conta. A implementação padrão fala com o Supabase Auth, a Edge Function
// `identity` e leituras com RLS; os testes injetam fakes pelo IdentityServicesProvider.
import { createContext, type ReactNode, useContext, useMemo } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { type BusinessCreateInput, BusinessCreateOutput, Profession } from "@contracts";
import { FIXED_NOW, FX, tenantA } from "@contracts/fixtures.ts";
import type { z } from "zod";
import {
  CustomerLinkRedeemOutput,
  CustomerLinkRevokeOutput,
  MyBooking,
  MyCustomerLink,
  Onboarding,
  OnboardingSaveOutput,
  type OnboardingSaveInput,
} from "@contracts";
import { appEnv } from "../../app/env.ts";
import { useSession } from "../../app/session.tsx";
import { createApiClient } from "../../lib/api/client.ts";
import { customerBookings } from "../../lib/demo/journey.ts";
import { supabase } from "../../lib/supabase.ts";

export type BusinessDraft = z.input<typeof BusinessCreateInput>;
export interface BusinessSummary {
  name: string;
  profession: Profession;
}

/** Primeiros passos do negócio (E9/E13). null = não deu para saber (a tela mostra o passo como link, sem ✓). */
export interface SetupProgress {
  services: boolean | null;
  hours: boolean | null;
  profile: boolean | null;
}

export interface IdentityServices {
  /** false = demonstração offline: nada é gravado, formulários ficam desabilitados. */
  online: boolean;
  createBusiness(input: BusinessDraft, idempotencyKey: string): Promise<z.infer<typeof BusinessCreateOutput>>;
  /** Nome e profissão do negócio selecionado (RLS: só membros leem). */
  loadBusiness(tenantId: string): Promise<BusinessSummary | null>;
  loadOnboarding(tenantId: string): Promise<Onboarding | null>;
  /** Já tem serviço ativo, horário de atendimento e perfil publicado? Leituras com RLS; cada uma falha sozinha. */
  loadSetup(tenantId: string): Promise<SetupProgress>;
  saveOnboarding(
    tenantId: string,
    input: z.input<typeof OnboardingSaveInput>,
    idempotencyKey: string,
  ): Promise<Onboarding>;
  loadMyLinks(): Promise<MyCustomerLink[]>;
  /** Minhas reservas (public.my_bookings): só leitura; `now` é o relógio da fonte (fixo na demonstração). */
  loadMyBookings(): Promise<{ now: string; bookings: MyBooking[] }>;
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
  /** `email_unavailable`: o cadastro recusou o e-mail (já usado ou não aceito). A tela não diz qual dos dois. */
  constructor(readonly kind: "weak_password" | "rate_limited" | "email_unavailable" | "failed") {
    super(kind);
    this.name = "AuthFlowError";
  }
}

function authError(error: { status?: number; code?: string } | null): AuthFlowError | null {
  if (!error) return null;
  if (error.code === "weak_password") return new AuthFlowError("weak_password");
  if (error.status === 429 || error.code === "over_email_send_rate_limit") return new AuthFlowError("rate_limited");
  if (error.code === "user_already_exists" || error.code === "email_exists" || error.code === "email_address_invalid") {
    return new AuthFlowError("email_unavailable");
  }
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
      // Demonstração: o progresso fica nas outras telas desta aba; aqui os passos aparecem só como atalhos.
      loadSetup: async () => ({ services: null, hours: null, profile: null }),
      loadMyLinks: async () => [],
      // Demonstração: a cliente é a Cliente Exemplo Ana, com as reservas da Agenda desta aba.
      loadMyBookings: async () => ({ now: FIXED_NOW, bookings: MyBooking.array().parse(await customerBookings(FX.customers.abInA)) }),
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
    async loadSetup(tenantId) {
      const exists = async (query: PromiseLike<{ count: number | null; error: unknown }>) => {
        const { count, error } = await query;
        return error ? null : (count ?? 0) > 0;
      };
      const head = { count: "exact" as const, head: true };
      const [services, hours, profile] = await Promise.all([
        exists(client.from("provider_services").select("id", head).eq("tenant_id", tenantId).eq("active", true)),
        exists(client.from("availability_rules").select("id", head).eq("tenant_id", tenantId)),
        exists(client.from("public_profiles").select("id", head).eq("tenant_id", tenantId).not("published_at", "is", null)),
      ]);
      return { services, hours, profile };
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
    async loadMyBookings() {
      const { data, error } = await client.rpc("my_bookings");
      if (error) throw new AuthFlowError("failed");
      return { now: new Date().toISOString(), bookings: MyBooking.array().max(200).parse(data ?? []) };
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
