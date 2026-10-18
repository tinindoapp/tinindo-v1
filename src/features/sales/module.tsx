// Módulo Orçamentos · P11 (tasks/P11.md). Só esta pasta pertence ao módulo; src/app/modules.ts é do integrador.
// Sem Supabase (demonstração offline) usa a emulação local, sempre rotulada; com Supabase, a função `sales`.
import { useMemo } from "react";
import type { RouteObject } from "react-router";
import type { ModuleDefinition } from "../../app/module-types.ts";
import { appEnv } from "../../app/env.ts";
import { useSession } from "../../app/session.tsx";
import { Card, StatusBanner } from "../../components/ui/index.tsx";
import { createApiClient } from "../../lib/api/client.ts";
import { createDemoLinkPort, createDemoPort } from "./demoPort.ts";
import type { QuoteLinkPort, SalesPort } from "./port.ts";
import { QuoteLinkPage } from "./QuoteLinkPage.tsx";
import { QuotesPage, SalesPortProvider } from "./QuotesPage.tsx";
import { createServerLinkPort, createServerPort } from "./serverPort.ts";
import "./sales.css";

function SalesLayout() {
  const { state, tenantId, getAccessToken } = useSession();
  const port = useMemo<SalesPort | null>(() => {
    if (state.status === "offline_demo" || !appEnv.supabase) return createDemoPort();
    if (!tenantId) return null;
    return createServerPort(createApiClient({ baseUrl: appEnv.supabase.url, publishableKey: appEnv.supabase.publishableKey, getAccessToken }), tenantId);
  }, [state.status, tenantId, getAccessToken]);
  if (!port) {
    return (
      <Card aria-labelledby="qt-no-tenant">
        <h1 id="qt-no-tenant">Orçamentos</h1>
        <StatusBanner tone="info">Selecione um negócio para ver os orçamentos.</StatusBanner>
      </Card>
    );
  }
  return (
    <SalesPortProvider value={port}>
      <QuotesPage key={`${port.kind}:${tenantId ?? ""}`} />
    </SalesPortProvider>
  );
}

function PublicQuote() {
  const port = useMemo<QuoteLinkPort>(() => {
    if (!appEnv.supabase) return createDemoLinkPort();
    // Link anônimo: sem token de sessão; o token do orçamento vai no corpo do POST.
    return createServerLinkPort(createApiClient({ baseUrl: appEnv.supabase.url, publishableKey: appEnv.supabase.publishableKey, getAccessToken: async () => null }));
  }, []);
  return <QuoteLinkPage port={port} />;
}

/** Rotas públicas, fora do shell autenticado (montadas em src/app/router.tsx). */
export const salesPublicRoutes: RouteObject[] = [{ path: "/orcamento", element: <PublicQuote /> }];

export const salesModule: ModuleDefinition = {
  id: "sales",
  owner: "P11",
  path: "orcamentos",
  navLabel: "Orçamentos",
  routes: [{ index: true, element: <SalesLayout /> }],
};
