// Módulo Configuração · P44 (tasks/P44.md). Só esta pasta pertence ao módulo; src/app/modules.ts é do integrador.
// Sem Supabase (demonstração offline) usa a emulação local, sempre rotulada; com Supabase, a função `setup`.
// O cartão da Home (SetupCard) é exportado daqui; a Home o liga com a mesma porta.
import { useMemo } from "react";
import type { ModuleDefinition } from "../../app/module-types.ts";
import { appEnv } from "../../app/env.ts";
import { useSession } from "../../app/session.tsx";
import { Card, StatusBanner } from "../../components/ui/index.tsx";
import { createApiClient } from "../../lib/api/client.ts";
import { createDemoPort } from "./demoPort.ts";
import type { SetupPort } from "./port.ts";
import { SetupPage } from "./SetupPage.tsx";
import { createServerPort } from "./serverPort.ts";

export { SetupCard } from "./SetupCard.tsx";

/** Porta do módulo para a sessão atual (a Home usa a mesma regra). null = conta sem negócio selecionado. */
export function useSetupPort(): SetupPort | null {
  const { state, tenantId, getAccessToken } = useSession();
  return useMemo<SetupPort | null>(() => {
    if (state.status === "offline_demo" || !appEnv.supabase) return createDemoPort();
    if (!tenantId) return null;
    return createServerPort(createApiClient({ baseUrl: appEnv.supabase.url, publishableKey: appEnv.supabase.publishableKey, getAccessToken }), tenantId);
  }, [state.status, tenantId, getAccessToken]);
}

function SetupLayout() {
  const port = useSetupPort();
  const { tenantId } = useSession();
  if (!port) {
    return (
      <Card aria-labelledby="setup-no-tenant">
        <h1 id="setup-no-tenant">Configuração</h1>
        <StatusBanner tone="info">Selecione um negócio para ver os passos da configuração.</StatusBanner>
      </Card>
    );
  }
  return <SetupPage key={`${port.kind}:${tenantId ?? ""}`} port={port} />;
}

export const setupModule: ModuleDefinition = {
  id: "setup",
  owner: "P44",
  path: "configurar",
  navLabel: "Configuração",
  routes: [{ index: true, element: <SetupLayout /> }],
};
