// Módulo Lista de espera · P06 (tasks/P06.md). Só esta pasta pertence ao módulo; src/app/modules.ts é do integrador.
// Sem Supabase (demonstração offline) usa a emulação local, rotulada; com Supabase, a função `waitlist`.
import { useMemo } from "react";
import type { RouteObject } from "react-router";
import type { ModuleDefinition } from "../../app/module-types.ts";
import { appEnv } from "../../app/env.ts";
import { useSession } from "../../app/session.tsx";
import { Card, StatusBanner } from "../../components/ui/index.tsx";
import { createApiClient } from "../../lib/api/client.ts";
import { createDemoLinkPort, createDemoPort } from "./demoPort.ts";
import { OfferPage } from "./OfferPage.tsx";
import type { OfferLinkPort, WaitlistPort } from "./port.ts";
import { createServerLinkPort, createServerPort } from "./serverPort.ts";
import { WaitlistPage, WaitlistPortProvider } from "./WaitlistPage.tsx";
import "./waitlist.css";

function WaitlistLayout() {
  const { state, tenantId, getAccessToken } = useSession();
  const port = useMemo<WaitlistPort | null>(() => {
    if (state.status === "offline_demo" || !appEnv.supabase) return createDemoPort();
    if (!tenantId) return null;
    return createServerPort(createApiClient({ baseUrl: appEnv.supabase.url, publishableKey: appEnv.supabase.publishableKey, getAccessToken }), tenantId);
  }, [state.status, tenantId, getAccessToken]);
  if (!port) {
    return (
      <Card aria-labelledby="wl-no-tenant">
        <h1 id="wl-no-tenant">Lista de espera</h1>
        <StatusBanner tone="info">Selecione um negócio para ver a lista de espera.</StatusBanner>
      </Card>
    );
  }
  return (
    <WaitlistPortProvider value={port}>
      <WaitlistPage key={`${port.kind}:${tenantId ?? ""}`} />
    </WaitlistPortProvider>
  );
}

function PublicOffer() {
  const port = useMemo<OfferLinkPort>(() => {
    if (!appEnv.supabase) return createDemoLinkPort();
    // Link anônimo: sem token de sessão; o token da oferta vai no corpo do POST.
    return createServerLinkPort(createApiClient({ baseUrl: appEnv.supabase.url, publishableKey: appEnv.supabase.publishableKey, getAccessToken: async () => null }));
  }, []);
  return <OfferPage port={port} />;
}

/** Rotas públicas, fora do shell autenticado (montadas em src/app/router.tsx). */
export const waitlistPublicRoutes: RouteObject[] = [{ path: "/oferta", element: <PublicOffer /> }];

export const waitlistModule: ModuleDefinition = {
  id: "waitlist",
  owner: "P06",
  path: "lista-de-espera",
  navLabel: "Lista de espera",
  routes: [{ index: true, element: <WaitlistLayout /> }],
};
