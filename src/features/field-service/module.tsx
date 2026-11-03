// Módulo Domicílio · P29 (tasks/P29.md). Só esta pasta pertence ao módulo; src/app/modules.ts é do integrador.
// Sem Supabase (demonstração offline) usa a emulação local, sempre rotulada; com Supabase, a função `field-service`.
import { useMemo } from "react";
import type { ModuleDefinition } from "../../app/module-types.ts";
import { appEnv } from "../../app/env.ts";
import { useSession } from "../../app/session.tsx";
import { Card, StatusBanner } from "../../components/ui/index.tsx";
import { createApiClient } from "../../lib/api/client.ts";
import { createDemoPort } from "./demoPort.ts";
import type { FieldPort } from "./port.ts";
import { FieldPage } from "./FieldPage.tsx";
import { createServerPort } from "./serverPort.ts";
import "./field.css";

function FieldLayout() {
  const { state, tenantId, getAccessToken } = useSession();
  const port = useMemo<FieldPort | null>(() => {
    if (state.status === "offline_demo" || !appEnv.supabase) return createDemoPort();
    if (!tenantId) return null;
    return createServerPort(createApiClient({ baseUrl: appEnv.supabase.url, publishableKey: appEnv.supabase.publishableKey, getAccessToken }), tenantId);
  }, [state.status, tenantId, getAccessToken]);
  if (!port) {
    return (
      <Card aria-labelledby="fs-no-tenant">
        <h1 id="fs-no-tenant">Domicílio</h1>
        <StatusBanner tone="info">Selecione um negócio para ver o atendimento a domicílio.</StatusBanner>
      </Card>
    );
  }
  return <FieldPage key={`${port.kind}:${tenantId ?? ""}`} port={port} />;
}

export const fieldServiceModule: ModuleDefinition = {
  id: "field-service",
  owner: "P29",
  path: "domicilio",
  navLabel: "Domicílio",
  routes: [{ index: true, element: <FieldLayout /> }],
};
