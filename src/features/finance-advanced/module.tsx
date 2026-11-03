// Módulo Contas · P31 (tasks/P31.md). Só esta pasta pertence ao módulo; src/app/modules.ts é do integrador.
// Sem Supabase (demonstração offline) usa a emulação local, sempre rotulada; com Supabase, a função `finance-advanced`.
import { useMemo } from "react";
import type { ModuleDefinition } from "../../app/module-types.ts";
import { appEnv } from "../../app/env.ts";
import { useSession } from "../../app/session.tsx";
import { Card, StatusBanner } from "../../components/ui/index.tsx";
import { createApiClient } from "../../lib/api/client.ts";
import { createDemoPort } from "./demoPort.ts";
import type { AccountsPort } from "./port.ts";
import { AccountsPage } from "./AccountsPage.tsx";
import { createServerPort } from "./serverPort.ts";
import "./accounts.css";

function AccountsLayout() {
  const { state, tenantId, getAccessToken } = useSession();
  const port = useMemo<AccountsPort | null>(() => {
    if (state.status === "offline_demo" || !appEnv.supabase) return createDemoPort();
    if (!tenantId) return null;
    return createServerPort(createApiClient({ baseUrl: appEnv.supabase.url, publishableKey: appEnv.supabase.publishableKey, getAccessToken }), tenantId);
  }, [state.status, tenantId, getAccessToken]);
  if (!port) {
    return (
      <Card aria-labelledby="acc-no-tenant">
        <h1 id="acc-no-tenant">Contas</h1>
        <StatusBanner tone="info">Selecione um negócio para ver as contas.</StatusBanner>
      </Card>
    );
  }
  return <AccountsPage key={`${port.kind}:${tenantId ?? ""}`} port={port} />;
}

export const financeAdvancedModule: ModuleDefinition = {
  id: "finance-advanced",
  owner: "P31",
  path: "contas",
  navLabel: "Contas",
  routes: [{ index: true, element: <AccountsLayout /> }],
};
