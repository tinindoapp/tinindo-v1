// Módulo Equipe · P28 (tasks/P28.md). Só esta pasta pertence ao módulo; src/app/modules.ts é do integrador.
// Sem Supabase (demonstração offline) usa a emulação local, sempre rotulada; com Supabase, a função `resources`.
import { useMemo } from "react";
import type { ModuleDefinition } from "../../app/module-types.ts";
import { appEnv } from "../../app/env.ts";
import { useSession } from "../../app/session.tsx";
import { Card, StatusBanner } from "../../components/ui/index.tsx";
import { createApiClient } from "../../lib/api/client.ts";
import { createDemoPort } from "./demoPort.ts";
import type { ResourcesPort } from "./port.ts";
import { ResourcesPage } from "./ResourcesPage.tsx";
import { createServerPort } from "./serverPort.ts";
import "./resources.css";

function ResourcesLayout() {
  const { state, tenantId, getAccessToken } = useSession();
  const port = useMemo<ResourcesPort | null>(() => {
    if (state.status === "offline_demo" || !appEnv.supabase) return createDemoPort();
    if (!tenantId) return null;
    return createServerPort(createApiClient({ baseUrl: appEnv.supabase.url, publishableKey: appEnv.supabase.publishableKey, getAccessToken }), tenantId);
  }, [state.status, tenantId, getAccessToken]);
  if (!port) {
    return (
      <Card aria-labelledby="rs-no-tenant">
        <h1 id="rs-no-tenant">Equipe</h1>
        <StatusBanner tone="info">Selecione um negócio para ver a equipe.</StatusBanner>
      </Card>
    );
  }
  return <ResourcesPage key={`${port.kind}:${tenantId ?? ""}`} port={port} />;
}

export const resourcesModule: ModuleDefinition = {
  id: "resources",
  owner: "P28",
  path: "equipe",
  navLabel: "Equipe",
  routes: [{ index: true, element: <ResourcesLayout /> }],
};
