// Módulo Resultado · P18 (tasks/P18.md). Só esta pasta pertence ao módulo; src/app/modules.ts é do integrador.
// Sem Supabase (demonstração offline) usa números sintéticos rotulados; com Supabase, a função `analytics`.
// O custo por cliente fica em /app/resultado/custo, fora do menu: o banco decide quem é operador.
import { useMemo } from "react";
import type { ModuleDefinition } from "../../app/module-types.ts";
import { appEnv } from "../../app/env.ts";
import { useSession } from "../../app/session.tsx";
import { Card, StatusBanner } from "../../components/ui/index.tsx";
import { createApiClient } from "../../lib/api/client.ts";
import { CostPage } from "./CostPage.tsx";
import { createDemoCostPort, createDemoPort } from "./demoPort.ts";
import type { AnalyticsPort, CostPort } from "./port.ts";
import { ResultPage } from "./ResultPage.tsx";
import { createServerCostPort, createServerPort } from "./serverPort.ts";
import "./analytics.css";

function ResultLayout() {
  const { state, tenantId, getAccessToken } = useSession();
  const port = useMemo<AnalyticsPort | null>(() => {
    if (state.status === "offline_demo" || !appEnv.supabase) return createDemoPort();
    if (!tenantId) return null;
    return createServerPort(createApiClient({ baseUrl: appEnv.supabase.url, publishableKey: appEnv.supabase.publishableKey, getAccessToken }), tenantId);
  }, [state.status, tenantId, getAccessToken]);
  if (!port) {
    return (
      <Card aria-labelledby="an-no-tenant">
        <h1 id="an-no-tenant">Resultado</h1>
        <StatusBanner tone="info">Selecione um negócio para ver os indicadores.</StatusBanner>
      </Card>
    );
  }
  return <ResultPage key={`${port.kind}:${tenantId ?? ""}`} port={port} />;
}

const demoNow = () => new Date(Date.parse("2026-10-20T12:00:00Z"));
const realNow = () => new Date();

function CostLayout() {
  const { state, getAccessToken } = useSession();
  const port = useMemo<CostPort>(() => {
    if (state.status === "offline_demo" || !appEnv.supabase) return createDemoCostPort();
    return createServerCostPort(createApiClient({ baseUrl: appEnv.supabase.url, publishableKey: appEnv.supabase.publishableKey, getAccessToken }));
  }, [state.status, getAccessToken]);
  return <CostPage port={port} now={port.kind === "demo" ? demoNow : realNow} />;
}

export const analyticsModule: ModuleDefinition = {
  id: "analytics",
  owner: "P18",
  path: "resultado",
  navLabel: "Resultado",
  routes: [
    { index: true, element: <ResultLayout /> },
    { path: "custo", element: <CostLayout /> },
  ],
};
