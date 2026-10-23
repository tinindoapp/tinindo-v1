// Módulo Campanhas · P19 (tasks/P19.md). Só esta pasta pertence ao módulo; src/app/modules.ts é do integrador.
import { useMemo } from "react";
import type { ModuleDefinition } from "../../app/module-types.ts";
import { appEnv } from "../../app/env.ts";
import { useSession } from "../../app/session.tsx";
import { Card, StatusBanner } from "../../components/ui/index.tsx";
import { createApiClient } from "../../lib/api/client.ts";
import { createDemoPort } from "./demoPort.ts";
import type { CampaignsPort } from "./port.ts";
import { CampaignsPage } from "./CampaignsPage.tsx";
import { createServerPort } from "./serverPort.ts";
import "./campaigns.css";

function CampaignsLayout() {
  const { state, tenantId, getAccessToken } = useSession();
  const port = useMemo<CampaignsPort | null>(() => {
    if (state.status === "offline_demo" || !appEnv.supabase) return createDemoPort();
    if (!tenantId) return null;
    return createServerPort(createApiClient({ baseUrl: appEnv.supabase.url, publishableKey: appEnv.supabase.publishableKey, getAccessToken }), tenantId);
  }, [state.status, tenantId, getAccessToken]);
  if (!port) {
    return (
      <Card aria-labelledby="cp-no-tenant">
        <h1 id="cp-no-tenant">Campanhas</h1>
        <StatusBanner tone="info">Selecione um negócio para ver as indicações.</StatusBanner>
      </Card>
    );
  }
  return <CampaignsPage key={`${port.kind}:${tenantId ?? ""}`} port={port} />;
}

export const campaignsModule: ModuleDefinition = {
  id: "campaigns",
  owner: "P19",
  path: "campanhas",
  navLabel: "Campanhas",
  routes: [{ index: true, element: <CampaignsLayout /> }],
};
