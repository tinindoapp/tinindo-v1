// Módulo Site e Google · P17 (tasks/P17.md). Só esta pasta pertence ao módulo; src/app/modules.ts é do integrador.
import { useMemo } from "react";
import type { RouteObject } from "react-router";
import type { ModuleDefinition } from "../../app/module-types.ts";
import { appEnv } from "../../app/env.ts";
import { useSession } from "../../app/session.tsx";
import { PageHeader, StatusBanner } from "../../components/ui/index.tsx";
import { createApiClient } from "../../lib/api/client.ts";
import { createDemoPort, createDemoPublicPort } from "./demoPort.ts";
import type { PresencePort, PublicSitePort } from "./port.ts";
import { PresencePage } from "./PresencePage.tsx";
import { PublicSitePage } from "./PublicSitePage.tsx";
import { createServerPort, createServerPublicPort } from "./serverPort.ts";
import "./presence.css";

function PresenceLayout() {
  const { state, tenantId, getAccessToken } = useSession();
  const port = useMemo<PresencePort | null>(() => {
    if (state.status === "offline_demo" || !appEnv.supabase) return createDemoPort();
    if (!tenantId) return null;
    return createServerPort(createApiClient({ baseUrl: appEnv.supabase.url, publishableKey: appEnv.supabase.publishableKey, getAccessToken }), tenantId);
  }, [state.status, tenantId, getAccessToken]);
  if (!port) {
    return (
      <div className="tn-page-intro">
        <PageHeader id="prs-no-tenant" title="Site e Google" />
        <StatusBanner tone="info">Selecione um negócio para cuidar do site.</StatusBanner>
      </div>
    );
  }
  return <PresencePage key={`${port.kind}:${tenantId ?? ""}`} port={port} />;
}

function PublicSite() {
  const port = useMemo<PublicSitePort>(() => {
    if (!appEnv.supabase) return createDemoPublicPort();
    return createServerPublicPort(createApiClient({ baseUrl: appEnv.supabase.url, publishableKey: appEnv.supabase.publishableKey, getAccessToken: async () => null }));
  }, []);
  return <PublicSitePage port={port} />;
}

/** Rotas públicas, fora do shell autenticado (montadas em src/app/router.tsx). */
export const presencePublicRoutes: RouteObject[] = [{ path: "/s/:slug", element: <PublicSite /> }];

export const presenceModule: ModuleDefinition = {
  id: "presence",
  owner: "P17",
  path: "site",
  navLabel: "Site e Google",
  routes: [{ index: true, element: <PresenceLayout /> }],
};
