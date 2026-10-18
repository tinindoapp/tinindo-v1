// Sessão e negócio selecionado. A seleção é preferência de interface; o servidor revalida
// tudo em cada chamada (resolve_context/RLS). P01 substitui o login provisório pelo onboarding.
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { tenantA } from "@contracts/fixtures.ts";

export interface MembershipView {
  tenant_id: string;
  tenant_name: string;
  role: "owner" | "staff";
}

export type SessionState =
  | { status: "loading" }
  | { status: "signed_out" }
  /** Sem Supabase configurado: navegação de demonstração com fixtures, sem servidor. */
  | { status: "offline_demo"; memberships: MembershipView[] }
  | { status: "signed_in"; email: string; memberships: MembershipView[] };

interface SessionApi {
  state: SessionState;
  tenantId: string | null;
  selectTenant(id: string): void;
  signIn(email: string, password: string): Promise<string | null>;
  signOut(): Promise<void>;
  getAccessToken(): Promise<string | null>;
}

const SessionContext = createContext<SessionApi | null>(null);
const TENANT_KEY = "tinindo.selectedTenant";

function readStoredTenant(): string | null {
  try {
    return localStorage.getItem(TENANT_KEY);
  } catch {
    return null;
  }
}

async function loadMemberships(client: SupabaseClient, userId: string): Promise<MembershipView[]> {
  const { data, error } = await client
    .from("tenant_memberships")
    .select("tenant_id, role, tenants(name)")
    .eq("user_id", userId)
    .eq("active", true)
    .limit(50);
  if (error || !data) return [];
  return data.map((m) => {
    const tenants = m.tenants as { name: string } | { name: string }[] | null;
    const name = Array.isArray(tenants) ? tenants[0]?.name : tenants?.name;
    return { tenant_id: m.tenant_id as string, role: m.role as "owner" | "staff", tenant_name: name ?? "Negócio" };
  });
}

export function SessionProvider({ client, children }: { client: SupabaseClient | null; children: ReactNode }) {
  const [state, setState] = useState<SessionState>(() =>
    client
      ? { status: "loading" }
      : { status: "offline_demo", memberships: [{ tenant_id: tenantA.id, tenant_name: tenantA.name, role: "owner" }] },
  );
  const [tenantId, setTenantId] = useState<string | null>(readStoredTenant);

  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    const apply = async (session: { user: { id: string; email?: string } } | null) => {
      if (!session) {
        if (!cancelled) setState({ status: "signed_out" });
        return;
      }
      const memberships = await loadMemberships(client, session.user.id);
      if (!cancelled) setState({ status: "signed_in", email: session.user.email ?? "", memberships });
    };
    void client.auth.getSession().then(({ data }) => apply(data.session));
    const { data: sub } = client.auth.onAuthStateChange((_event, session) => {
      // Fora do callback síncrono do supabase-js para não travar o lock interno.
      setTimeout(() => void apply(session), 0);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [client]);

  const memberships = state.status === "signed_in" || state.status === "offline_demo" ? state.memberships : [];
  const effectiveTenant =
    memberships.find((m) => m.tenant_id === tenantId)?.tenant_id ?? memberships[0]?.tenant_id ?? null;

  const selectTenant = useCallback((id: string) => {
    setTenantId(id);
    try {
      localStorage.setItem(TENANT_KEY, id);
    } catch {
      /* armazenamento indisponível: seleção vale só nesta aba */
    }
  }, []);

  const api = useMemo<SessionApi>(
    () => ({
      state,
      tenantId: effectiveTenant,
      selectTenant,
      async signIn(email, password) {
        if (!client) return "Servidor não configurado neste ambiente.";
        const { error } = await client.auth.signInWithPassword({ email, password });
        return error ? "E-mail ou senha inválidos." : null;
      },
      async signOut() {
        await client?.auth.signOut();
      },
      async getAccessToken() {
        if (!client) return null;
        const { data } = await client.auth.getSession();
        return data.session?.access_token ?? null;
      },
    }),
    [client, state, effectiveTenant, selectTenant],
  );

  return <SessionContext.Provider value={api}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionApi {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession fora do SessionProvider");
  return ctx;
}
