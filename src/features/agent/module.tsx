// Módulo Assistente · P08 (tasks/P08.md). Só esta pasta pertence ao módulo; src/app/modules.ts é do integrador.
// Sem Supabase (demonstração offline) usa o mesmo motor sobre dados de exemplo; com Supabase, a função `agent`.
import { useMemo } from "react";
import type { ModuleDefinition } from "../../app/module-types.ts";
import { appEnv } from "../../app/env.ts";
import { useSession } from "../../app/session.tsx";
import { PageHeader, StatusBanner } from "../../components/ui/index.tsx";
import { createApiClient } from "../../lib/api/client.ts";
import { AgentPage, AgentPortProvider } from "./AgentPage.tsx";
import { createDemoPort } from "./demoPort.ts";
import type { AgentPort } from "./port.ts";
import { createServerPort } from "./serverPort.ts";
import "./agent.css";

function AgentLayout() {
  const { state, tenantId, getAccessToken } = useSession();
  const port = useMemo<AgentPort | null>(() => {
    if (state.status === "offline_demo" || !appEnv.supabase) return createDemoPort();
    if (!tenantId) return null;
    return createServerPort(createApiClient({ baseUrl: appEnv.supabase.url, publishableKey: appEnv.supabase.publishableKey, getAccessToken }), tenantId);
  }, [state.status, tenantId, getAccessToken]);
  if (!port) {
    return (
      <div className="tn-page-intro">
        <PageHeader id="ag-no-tenant" title="Assistente" />
        <StatusBanner tone="info">Selecione um negócio para usar o assistente.</StatusBanner>
      </div>
    );
  }
  return (
    <AgentPortProvider value={port}>
      {/* Trocar de negócio recomeça a conversa: nada de um negócio vira contexto de outro. */}
      <AgentPage key={`${port.kind}:${tenantId ?? ""}`} />
    </AgentPortProvider>
  );
}

export const agentModule: ModuleDefinition = {
  id: "agent",
  owner: "P08",
  path: "assistente",
  navLabel: "Assistente",
  routes: [{ index: true, element: <AgentLayout /> }],
};
