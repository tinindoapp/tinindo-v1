// Módulo Materiais · P30 (tasks/P30.md). Só esta pasta pertence ao módulo; src/app/modules.ts é do integrador.
// Sem Supabase (demonstração offline) usa a emulação local, sempre rotulada; com Supabase, a função `materials`.
import { useMemo } from "react";
import type { ModuleDefinition } from "../../app/module-types.ts";
import { appEnv } from "../../app/env.ts";
import { useSession } from "../../app/session.tsx";
import { Card, StatusBanner } from "../../components/ui/index.tsx";
import { createApiClient } from "../../lib/api/client.ts";
import { createDemoPort } from "./demoPort.ts";
import type { MaterialsPort } from "./port.ts";
import { MaterialsPage } from "./MaterialsPage.tsx";
import { createServerPort } from "./serverPort.ts";
import "./materials.css";

function MaterialsLayout() {
  const { state, tenantId, getAccessToken } = useSession();
  const port = useMemo<MaterialsPort | null>(() => {
    if (state.status === "offline_demo" || !appEnv.supabase) return createDemoPort();
    if (!tenantId) return null;
    return createServerPort(createApiClient({ baseUrl: appEnv.supabase.url, publishableKey: appEnv.supabase.publishableKey, getAccessToken }), tenantId);
  }, [state.status, tenantId, getAccessToken]);
  if (!port) {
    return (
      <Card aria-labelledby="mt-no-tenant">
        <h1 id="mt-no-tenant">Materiais</h1>
        <StatusBanner tone="info">Selecione um negócio para ver materiais e custos.</StatusBanner>
      </Card>
    );
  }
  return <MaterialsPage key={`${port.kind}:${tenantId ?? ""}`} port={port} />;
}

export const materialsModule: ModuleDefinition = {
  id: "materials",
  owner: "P30",
  path: "materiais",
  navLabel: "Materiais",
  routes: [{ index: true, element: <MaterialsLayout /> }],
};
