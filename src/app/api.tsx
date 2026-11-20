// Acesso dos módulos ao servidor (P53, R4 e R5 do doc 15): um cliente por sessão, criado em session.tsx, e o contexto
// do negócio já carregado. Módulo não cria cliente (`createApiClient` em `src/features` é barrado pelo lint) nem pede
// `/context` para saber fuso ou papel: usa `useApi()`, `usePort()` e `useBusiness()`.
import { useMemo } from "react";
import type { MemberRole, Profession } from "@contracts";
import { Button, StatusBanner } from "../components/ui/index.tsx";
import { createApiClient } from "../lib/api/client.ts";
import type { ApiCall } from "../lib/api/session-client.ts";
import { appEnv } from "./env.ts";
import { useScope } from "./scope.tsx";
import { useSession } from "./session.tsx";

export type { ApiCall };

export interface ApiAccess {
  /** Demonstração offline (sem Supabase ou sem servidor): o módulo usa a porta de demonstração. */
  demo: boolean;
  /** O cliente da sessão; null na demonstração. */
  call: ApiCall | null;
  /** Negócio escolhido; null sem negócio. */
  tenantId: string | null;
}

export function useApi(): ApiAccess {
  const { state, api, tenantId } = useSession();
  const demo = state.status === "offline_demo" || !appEnv.supabase || !api;
  return { demo, call: demo ? null : api, tenantId };
}

export interface PortFactories<P> {
  /** Porta da demonstração. */
  demo(): P;
  /** Porta do servidor com o cliente da sessão. Com `tenant: "required"` (padrão) só é chamada com negócio escolhido. */
  server(call: ApiCall, tenantId: string): P;
}

/**
 * A porta do módulo para a sessão atual: a de demonstração ou a do servidor, recriada só quando muda o modo, o cliente
 * ou o negócio. As fábricas precisam ser funções estáveis (as do módulo, declaradas fora do componente). null quando
 * o servidor exige negócio e não há negócio escolhido: a tela mostra "Selecione um negócio".
 */
export function usePort<P>(factories: PortFactories<P>): P | null {
  const { demo, call, tenantId } = useApi();
  const { demo: makeDemo, server: makeServer } = factories;
  return useMemo(
    () => (demo ? makeDemo() : call && tenantId ? makeServer(call, tenantId) : null),
    [demo, call, tenantId, makeDemo, makeServer],
  );
}

/** Igual a `usePort`, para portas que não dependem de negócio (cliente final logado, sem negócio). */
export function useSessionPort<P>(factories: { demo(): P; server(call: ApiCall): P }): P {
  const { demo, call } = useApi();
  const { demo: makeDemo, server: makeServer } = factories;
  return useMemo(() => (demo || !call ? makeDemo() : makeServer(call)), [demo, call, makeDemo, makeServer]);
}

export interface Business {
  tenantId: string;
  name: string;
  role: MemberRole;
  timezone: string;
  /** Do escopo do negócio (`setup.scope`); null enquanto carrega ou fora do shell. */
  profession: Profession | null;
}

/** Contexto do negócio escolhido, ou null enquanto carrega, sem negócio ou se a leitura falhou. */
export function useBusiness(): Business | null {
  const { business } = useSession();
  const { profession } = useScope();
  return useMemo(
    () => (business.status === "ready" ? { ...business.business, profession } : null),
    [business, profession],
  );
}

/**
 * Fuso do negócio escolhido, da sessão (P53, R5). Antes três módulos começavam com o fuso da fixture e trocavam depois
 * de pedir `/context`; agora a tela espera o fuso de verdade. `pending` enquanto carrega, `failed` se a leitura falhou.
 */
export function useBusinessTimezone(): { timezone: string | null; failed: boolean; retry(): void } {
  const { business, reloadBusiness } = useSession();
  return {
    timezone: business.status === "ready" ? business.business.timezone : null,
    failed: business.status === "error",
    retry: reloadBusiness,
  };
}

/** O que a tela mostra enquanto o contexto do negócio não chegou (ou se falhou). */
export function BusinessPending({ failed, retry }: { failed: boolean; retry(): void }) {
  if (!failed) {
    return (
      <p className="tn-shell-loading" role="status">
        Carregando…
      </p>
    );
  }
  return (
    <StatusBanner tone="danger">
      Não foi possível carregar os dados do negócio. <Button variant="secondary" onClick={retry}>Tentar de novo</Button>
    </StatusBanner>
  );
}

let anonCall: ApiCall | null = null;
/**
 * Cliente anônimo das páginas públicas (diretório, link do cliente): sem login, só a chave pública. Um só no app.
 * null sem Supabase configurado (a página usa a demonstração).
 */
export function publicCall(): ApiCall | null {
  if (!appEnv.supabase) return null;
  anonCall ??= createApiClient({ baseUrl: appEnv.supabase.url, publishableKey: appEnv.supabase.publishableKey, getAccessToken: async () => null });
  return anonCall;
}
