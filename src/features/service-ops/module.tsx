// Módulo Plano e serviços · P15 (tasks/P15.md). Só esta pasta pertence ao módulo; src/app/modules.ts é do integrador.
// Sem Supabase (demonstração offline) usa a emulação local, sempre rotulada; com Supabase, a função `service-ops`.
// A tela da operação fica em /app/servicos-tinindo/operacao, fora do menu: o banco decide quem é operador.
import { useMemo } from "react";
import type { ModuleDefinition } from "../../app/module-types.ts";
import { appEnv } from "../../app/env.ts";
import { useSession } from "../../app/session.tsx";
import { Card, StatusBanner } from "../../components/ui/index.tsx";
import { createApiClient } from "../../lib/api/client.ts";
import { createDemoOpsPort, createDemoPort } from "./demoPort.ts";
import { OpsPage } from "./OpsPage.tsx";
import type { OpsPort, ServiceOpsPort } from "./port.ts";
import { createServerOpsPort, createServerPort } from "./serverPort.ts";
import { ServiceOpsPortProvider, ServicesPage } from "./ServicesPage.tsx";
import "./service-ops.css";

function ServicesLayout() {
  const { state, tenantId, getAccessToken } = useSession();
  const port = useMemo<ServiceOpsPort | null>(() => {
    if (state.status === "offline_demo" || !appEnv.supabase) return createDemoPort();
    if (!tenantId) return null;
    return createServerPort(createApiClient({ baseUrl: appEnv.supabase.url, publishableKey: appEnv.supabase.publishableKey, getAccessToken }), tenantId);
  }, [state.status, tenantId, getAccessToken]);
  if (!port) {
    return (
      <Card aria-labelledby="svc-no-tenant">
        <h1 id="svc-no-tenant">Plano e serviços</h1>
        <StatusBanner tone="info">Selecione um negócio para ver o plano e os serviços.</StatusBanner>
      </Card>
    );
  }
  return (
    <ServiceOpsPortProvider value={port}>
      <ServicesPage key={`${port.kind}:${tenantId ?? ""}`} />
    </ServiceOpsPortProvider>
  );
}

function OpsLayout() {
  const { state, getAccessToken } = useSession();
  const port = useMemo<OpsPort>(() => {
    if (state.status === "offline_demo" || !appEnv.supabase) return createDemoOpsPort();
    return createServerOpsPort(createApiClient({ baseUrl: appEnv.supabase.url, publishableKey: appEnv.supabase.publishableKey, getAccessToken }));
  }, [state.status, getAccessToken]);
  return <OpsPage key={port.kind} port={port} />;
}

export const serviceOpsModule: ModuleDefinition = {
  id: "service-ops",
  owner: "P15",
  path: "servicos-tinindo",
  navLabel: "Plano e serviços",
  routes: [
    { index: true, element: <ServicesLayout /> },
    { path: "operacao", element: <OpsLayout /> },
  ],
};
