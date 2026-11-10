// Módulo Metas e sugestões · P22 + P45 (tasks/P22.md, tasks/P45.md). Só esta pasta pertence ao módulo; src/app/modules.ts é do integrador.
import { useMemo } from "react";
import type { ModuleDefinition } from "../../app/module-types.ts";
import { appEnv } from "../../app/env.ts";
import { useSession } from "../../app/session.tsx";
import { PageHeader, StatusBanner } from "../../components/ui/index.tsx";
import { createApiClient } from "../../lib/api/client.ts";
import { createDemoPort } from "./demoPort.ts";
import type { GrowthAdvicePort } from "./port.ts";
import { GoalsPage } from "./GoalsPage.tsx";
import { createServerPort } from "./serverPort.ts";
import "./growth-advice.css";
import "./goals.css";

/** Porta do módulo para a sessão atual (demonstração rotulada ou servidor). Também usada pela Mensagens (resumo semanal). */
export function useGrowthAdvicePort(): GrowthAdvicePort | null {
  const { state, tenantId, getAccessToken } = useSession();
  return useMemo<GrowthAdvicePort | null>(() => {
    if (state.status === "offline_demo" || !appEnv.supabase) return createDemoPort();
    if (!tenantId) return null;
    return createServerPort(createApiClient({ baseUrl: appEnv.supabase.url, publishableKey: appEnv.supabase.publishableKey, getAccessToken }), tenantId);
  }, [state.status, tenantId, getAccessToken]);
}

function GoalsLayout() {
  const { tenantId } = useSession();
  const port = useGrowthAdvicePort();
  if (!port) {
    return (
      <div className="tn-page-intro">
        <PageHeader id="ga-no-tenant" title="Metas e sugestões" />
        <StatusBanner tone="info">Selecione um negócio para ver as metas.</StatusBanner>
      </div>
    );
  }
  return <GoalsPage key={`${port.kind}:${tenantId ?? ""}`} port={port} />;
}

export const growthAdviceModule: ModuleDefinition = {
  id: "growth-advice",
  owner: "P22",
  path: "metas",
  navLabel: "Metas e sugestões",
  routes: [{ index: true, element: <GoalsLayout /> }],
};
