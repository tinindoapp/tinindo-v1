// Módulo Diretório · P23 (tasks/P23.md). Só esta pasta pertence ao módulo; src/app/modules.ts é do integrador.
import { useMemo } from "react";
import type { RouteObject } from "react-router";
import type { ModuleDefinition } from "../../app/module-types.ts";
import { appEnv } from "../../app/env.ts";
import { useSession } from "../../app/session.tsx";
import { PageHeader, StatusBanner } from "../../components/ui/index.tsx";
import { createApiClient } from "../../lib/api/client.ts";
import { createDemoDirectoryPort, createDemoPort } from "./demoPort.ts";
import { DiscoverySettingsPage, PublicDirectoryPage } from "./DirectoryPages.tsx";
import type { DirectoryPort, DiscoveryPort } from "./port.ts";
import { createServerDirectoryPort, createServerPort } from "./serverPort.ts";
import "./discovery.css";

function SettingsLayout() {
  const { state, tenantId, getAccessToken } = useSession();
  const port = useMemo<DiscoveryPort | null>(() => {
    if (state.status === "offline_demo" || !appEnv.supabase) return createDemoPort();
    if (!tenantId) return null;
    return createServerPort(createApiClient({ baseUrl: appEnv.supabase.url, publishableKey: appEnv.supabase.publishableKey, getAccessToken }), tenantId);
  }, [state.status, tenantId, getAccessToken]);
  if (!port) {
    return (
      <div className="tn-page-intro">
        <PageHeader id="dir-no-tenant" title="Diretório" />
        <StatusBanner tone="info">Selecione um negócio.</StatusBanner>
      </div>
    );
  }
  return <DiscoverySettingsPage key={`${port.kind}:${tenantId ?? ""}`} port={port} />;
}

function PublicDirectory() {
  const port = useMemo<DirectoryPort>(() => {
    if (!appEnv.supabase) return createDemoDirectoryPort();
    return createServerDirectoryPort(createApiClient({ baseUrl: appEnv.supabase.url, publishableKey: appEnv.supabase.publishableKey, getAccessToken: async () => null }));
  }, []);
  return <PublicDirectoryPage port={port} />;
}

/** Rotas públicas, fora do shell autenticado (montadas em src/app/router.tsx). */
export const discoveryPublicRoutes: RouteObject[] = [
  { path: "/diretorio", element: <PublicDirectory /> },
  { path: "/diretorio/:uf/:cidade", element: <PublicDirectory /> },
  { path: "/diretorio/:uf/:cidade/:categoria", element: <PublicDirectory /> },
];

export const discoveryModule: ModuleDefinition = {
  id: "discovery",
  owner: "P23",
  path: "diretorio",
  navLabel: "Diretório",
  routes: [{ index: true, element: <SettingsLayout /> }],
};
