// Módulo Preços · P05 (tasks/P05.md). Só esta pasta pertence ao módulo; src/app/modules.ts é do integrador.
// Sem Supabase (demonstração offline) usa a emulação local, rotulada; com Supabase, a função `pricing`.
import { useMemo } from "react";
import type { ModuleDefinition } from "../../app/module-types.ts";
import { appEnv } from "../../app/env.ts";
import { useSession } from "../../app/session.tsx";
import { Card, StatusBanner } from "../../components/ui/index.tsx";
import { createApiClient } from "../../lib/api/client.ts";
import { createDemoPort } from "./demoPort.ts";
import type { PricingPort } from "./port.ts";
import { PricingPage, PricingPortProvider } from "./PricingPage.tsx";
import { createServerPort } from "./serverPort.ts";
import "./pricing.css";

let demoPort: PricingPort | null = null;
/** Uma emulação por carregamento de página: as mudanças valem enquanto a aba estiver aberta. */
function getDemoPort(): PricingPort {
  demoPort ??= createDemoPort();
  return demoPort;
}

function PricingLayout() {
  const { state, tenantId, getAccessToken } = useSession();
  const port = useMemo<PricingPort | null>(() => {
    if (state.status === "offline_demo" || !appEnv.supabase) return getDemoPort();
    if (!tenantId) return null;
    return createServerPort(createApiClient({ baseUrl: appEnv.supabase.url, publishableKey: appEnv.supabase.publishableKey, getAccessToken }), tenantId);
  }, [state.status, tenantId, getAccessToken]);
  if (!port) {
    return (
      <Card aria-labelledby="pr-no-tenant">
        <h1 id="pr-no-tenant">Preços</h1>
        <StatusBanner tone="info">Selecione um negócio para ver os preços.</StatusBanner>
      </Card>
    );
  }
  return (
    <PricingPortProvider value={port}>
      <PricingPage key={`${port.kind}:${tenantId ?? ""}`} />
    </PricingPortProvider>
  );
}

export const pricingModule: ModuleDefinition = {
  id: "pricing",
  owner: "P05",
  path: "precos",
  navLabel: "Preços",
  routes: [{ index: true, element: <PricingLayout /> }],
};
