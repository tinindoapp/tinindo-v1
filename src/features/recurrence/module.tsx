// Módulo Assinaturas · P20 (tasks/P20.md). Só esta pasta pertence ao módulo; src/app/modules.ts é do integrador.
// Sem Supabase (demonstração offline) usa a emulação local, sempre rotulada; com Supabase, a função `recurrence`.
import { useMemo } from "react";
import type { ModuleDefinition } from "../../app/module-types.ts";
import { appEnv } from "../../app/env.ts";
import { useSession } from "../../app/session.tsx";
import { Card, StatusBanner } from "../../components/ui/index.tsx";
import { createApiClient } from "../../lib/api/client.ts";
import { createDemoPort } from "./demoPort.ts";
import type { RecurrencePort } from "./port.ts";
import { RecurrencePage } from "./RecurrencePage.tsx";
import { createServerPort } from "./serverPort.ts";
import "./recurrence.css";

function RecurrenceLayout() {
  const { state, tenantId, getAccessToken } = useSession();
  const port = useMemo<RecurrencePort | null>(() => {
    if (state.status === "offline_demo" || !appEnv.supabase) return createDemoPort();
    if (!tenantId) return null;
    return createServerPort(createApiClient({ baseUrl: appEnv.supabase.url, publishableKey: appEnv.supabase.publishableKey, getAccessToken }), tenantId);
  }, [state.status, tenantId, getAccessToken]);
  if (!port) {
    return (
      <Card aria-labelledby="rc-no-tenant">
        <h1 id="rc-no-tenant">Assinaturas</h1>
        <StatusBanner tone="info">Selecione um negócio para ver os planos.</StatusBanner>
      </Card>
    );
  }
  return <RecurrencePage key={`${port.kind}:${tenantId ?? ""}`} port={port} />;
}

export const recurrenceModule: ModuleDefinition = {
  id: "recurrence",
  owner: "P20",
  path: "assinaturas",
  navLabel: "Assinaturas",
  routes: [{ index: true, element: <RecurrenceLayout /> }],
};
