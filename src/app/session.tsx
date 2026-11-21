// Sessão e negócio selecionado. A seleção é preferência de interface; o servidor revalida
// tudo em cada chamada (resolve_context/RLS). P01 substitui o login provisório pelo onboarding.
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ContextResponse, type MemberRole } from "@contracts";
import { tenantA } from "@contracts/fixtures.ts";
import { ApiError } from "../lib/api/client.ts";
import { createSessionClient, type SessionApiCall } from "../lib/api/session-client.ts";
import { appEnv } from "./env.ts";

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

/**
 * Contexto do negócio escolhido (P53, R5): o que `/context` devolve, lido uma vez por negócio e guardado na sessão.
 * Telas e portas usam daqui o fuso e o papel em vez de pedir `/context` de novo ou começar com o fuso da fixture.
 * A profissão vem do escopo (`useBusiness()` em api.tsx junta os dois).
 */
export interface BusinessContext {
  tenantId: string;
  name: string;
  role: MemberRole;
  /** Fuso IANA do negócio (validado no banco). */
  timezone: string;
  currency: "BRL";
}

export type BusinessState =
  | { status: "none" }
  | { status: "loading" }
  | { status: "ready"; business: BusinessContext }
  | { status: "error" };

interface SessionApi {
  state: SessionState;
  tenantId: string | null;
  /** Contexto do negócio escolhido; `none` sem negócio (ou sem login). */
  business: BusinessState;
  /** Fuso do negócio quando já carregou; null enquanto carrega, sem negócio ou se a leitura falhou. */
  timezone: string | null;
  /**
   * O cliente de API desta sessão (um só no app; P53, R4). null na demonstração offline e sem Supabase configurado.
   * Use por `useApi()` (src/app/api.tsx), não direto.
   */
  api: SessionApiCall | null;
  /** Lê o contexto do negócio de novo (depois de mudar nome ou fuso). */
  reloadBusiness(): void;
  /**
   * Equipe Tinindo (recado #88): true/false pela RPC `my_is_operator()`; null enquanto carrega ou se a leitura
   * falhar. Só para não mostrar telas da equipe a quem receberia FORBIDDEN; quem autoriza é o servidor.
   * Na demonstração offline é true (lá você também é a operadora).
   */
  isOperator: boolean | null;
  /**
   * Como a última sessão terminou: `user` quando a pessoa tocou em Sair; `expired` quando caiu sozinha (token vencido,
   * senha trocada em outro aparelho). A tela de entrar avisa e, no segundo caso, volta para onde a pessoa estava.
   */
  ended: "user" | "expired" | null;
  /** A pessoa chegou pelo link de "Esqueci minha senha": o shell leva à tela de nova senha até ela trocar. */
  recovering: boolean;
  /** Chamado depois de trocar a senha pelo link de recuperação. */
  endRecovery: () => void;
  selectTenant(id: string): void;
  signIn(email: string, password: string): Promise<string | null>;
  signOut(): Promise<void>;
  /** Reenvia o link de confirmação do cadastro. Sempre responde igual (não diz se o e-mail tem conta). */
  resendConfirmation(email: string): Promise<void>;
  getAccessToken(): Promise<string | null>;
}

const SessionContext = createContext<SessionApi | null>(null);
const TENANT_KEY = "tinindo.selectedTenant";

/**
 * Saída limpa: apaga o que o app guardou neste aparelho para a conta (negócio escolhido, memória das repetições da
 * Agenda, rascunhos). Tudo do app usa o prefixo `tinindo.`; o que é do Supabase Auth o próprio signOut apaga.
 */
export function forgetDeviceData(): void {
  for (const store of [() => localStorage, () => sessionStorage]) {
    try {
      const s = store();
      for (const key of Object.keys(s)) if (key.startsWith("tinindo.")) s.removeItem(key);
    } catch {
      /* armazenamento indisponível: nada guardado */
    }
  }
}

function readStoredTenant(): string | null {
  try {
    return localStorage.getItem(TENANT_KEY);
  } catch {
    return null;
  }
}

async function loadIsOperator(client: SupabaseClient): Promise<boolean | null> {
  try {
    const { data, error } = await client.rpc("my_is_operator");
    return error || typeof data !== "boolean" ? null : data;
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
  const [isOperator, setIsOperator] = useState<boolean | null>(client ? null : true);
  const [userId, setUserId] = useState<string | null>(null);
  const [ended, setEnded] = useState<"user" | "expired" | null>(null);
  const [recovering, setRecovering] = useState(false);
  const endRecovery = useCallback(() => setRecovering(false), []);
  // Sair pedido pela pessoa: a próxima sessão vazia é "saiu", não "expirou".
  const leaving = useRef(false);
  const hadSession = useRef(false);

  const getAccessToken = useCallback(async () => {
    if (!client) return null;
    const { data } = await client.auth.getSession();
    return data.session?.access_token ?? null;
  }, [client]);
  // Um cliente por sessão do navegador; trocar de login limpa o que ele guardou (o contexto do negócio).
  const api = useMemo(() => {
    if (!client || !appEnv.supabase) return null;
    const inner = createSessionClient({ baseUrl: appEnv.supabase.url, publishableKey: appEnv.supabase.publishableKey, getAccessToken });
    // Sessão que venceu de vez (o servidor responde AUTH_REQUIRED): encerra só neste aparelho, e o shell leva a
    // /entrar com "sua sessão terminou" e o destino. A renovação normal do token continua com o supabase-js.
    const call = (async (...args: Parameters<SessionApiCall>) => {
      try {
        return await inner(...args);
      } catch (err) {
        if (err instanceof ApiError && err.code === "AUTH_REQUIRED") void client.auth.signOut({ scope: "local" });
        throw err;
      }
    }) as SessionApiCall;
    call.forget = () => inner.forget();
    return call;
  }, [client, getAccessToken]);
  useEffect(() => api?.forget(), [api, userId]);

  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    const apply = async (session: { user: { id: string; email?: string } } | null) => {
      if (!session) {
        if (!cancelled) {
          if (hadSession.current) setEnded(leaving.current ? "user" : "expired");
          hadSession.current = false;
          leaving.current = false;
          setState({ status: "signed_out" });
          setIsOperator(null);
          setUserId(null);
        }
        return;
      }
      const [memberships, operator] = await Promise.all([loadMemberships(client, session.user.id), loadIsOperator(client)]);
      if (!cancelled) {
        hadSession.current = true;
        setEnded(null);
        setState({ status: "signed_in", email: session.user.email ?? "", memberships });
        setIsOperator(operator);
        setUserId(session.user.id);
      }
    };
    void client.auth.getSession().then(({ data }) => apply(data.session));
    const { data: sub } = client.auth.onAuthStateChange((event, session) => {
      // O link de recuperação pode cair na raiz do app (endereço fora da lista de redirecionamento do Auth).
      if (event === "PASSWORD_RECOVERY") setRecovering(true);
      // Fora do callback síncrono do supabase-js para não travar o lock interno.
      setTimeout(() => void apply(session), 0);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [client]);

  const memberships = useMemo(() => (state.status === "signed_in" || state.status === "offline_demo" ? state.memberships : []), [state]);
  const effectiveTenant =
    memberships.find((m) => m.tenant_id === tenantId)?.tenant_id ?? memberships[0]?.tenant_id ?? null;

  // Contexto do negócio: guardado com o negócio a que pertence, para trocar de negócio voltar a "carregando".
  const [loadedBusiness, setLoadedBusiness] = useState<{ tenant: string; business: BusinessContext | null } | null>(null);
  const [businessTick, setBusinessTick] = useState(0);
  const offline = state.status === "offline_demo";
  useEffect(() => {
    if (offline || !api || !effectiveTenant || state.status !== "signed_in") return;
    let alive = true;
    api("/context", ContextResponse, { tenantId: effectiveTenant }).then(
      (r) =>
        alive &&
        setLoadedBusiness({
          tenant: effectiveTenant,
          business: { tenantId: r.data.tenant_id, name: r.data.tenant_name, role: r.data.role, timezone: r.data.timezone, currency: r.data.currency },
        }),
      () => alive && setLoadedBusiness({ tenant: effectiveTenant, business: null }),
    );
    return () => {
      alive = false;
    };
  }, [offline, api, effectiveTenant, state.status, businessTick]);
  const business = useMemo<BusinessState>(() => {
    if (!effectiveTenant) return { status: "none" };
    if (offline) {
      const m = memberships.find((x) => x.tenant_id === effectiveTenant);
      // Demonstração: o negócio da fixture, com o fuso dela.
      return { status: "ready", business: { tenantId: effectiveTenant, name: m?.tenant_name ?? tenantA.name, role: m?.role ?? "owner", timezone: tenantA.timezone, currency: "BRL" } };
    }
    if (!loadedBusiness || loadedBusiness.tenant !== effectiveTenant) return { status: "loading" };
    return loadedBusiness.business ? { status: "ready", business: loadedBusiness.business } : { status: "error" };
  }, [effectiveTenant, offline, memberships, loadedBusiness]);
  const reloadBusiness = useCallback(() => {
    api?.forget();
    setLoadedBusiness(null);
    setBusinessTick((n) => n + 1);
  }, [api]);

  const selectTenant = useCallback((id: string) => {
    setTenantId(id);
    try {
      localStorage.setItem(TENANT_KEY, id);
    } catch {
      /* armazenamento indisponível: seleção vale só nesta aba */
    }
  }, []);

  const value = useMemo<SessionApi>(
    () => ({
      state,
      tenantId: effectiveTenant,
      business,
      timezone: business.status === "ready" ? business.business.timezone : null,
      api,
      reloadBusiness,
      isOperator,
      ended,
      recovering,
      endRecovery,
      selectTenant,
      async signIn(email, password) {
        if (!client) return "Servidor não configurado neste ambiente.";
        const { error } = await client.auth.signInWithPassword({ email, password });
        if (!error) return null;
        // Só depois de acertar a senha o Auth diz que falta confirmar: a mensagem não revela se o e-mail existe.
        if ((error as { code?: string }).code === "email_not_confirmed") return EMAIL_NOT_CONFIRMED;
        if ((error as { status?: number }).status === 429) return "Muitas tentativas. Espere alguns minutos e tente de novo.";
        return "E-mail ou senha inválidos.";
      },
      async resendConfirmation(email) {
        if (!client) return;
        // Só o limite de envio importa à tela; qualquer outro erro fica neutro.
        const { error } = await client.auth.resend({ type: "signup", email, options: { emailRedirectTo: `${window.location.origin}/app/conta/novo-negocio` } });
        if (error && (error as { status?: number }).status === 429) throw new Error("rate_limited");
      },
      async signOut() {
        leaving.current = true;
        api?.forget();
        forgetDeviceData();
        setTenantId(null);
        await client?.auth.signOut();
      },
      getAccessToken,
    }),
    [client, state, effectiveTenant, business, api, reloadBusiness, isOperator, ended, recovering, endRecovery, selectTenant, getAccessToken],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export const EMAIL_NOT_CONFIRMED = "Falta confirmar o e-mail. Abra o link que enviamos ou peça outro abaixo.";

export function useSession(): SessionApi {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession fora do SessionProvider");
  return ctx;
}
