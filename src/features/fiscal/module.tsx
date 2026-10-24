// Módulo Notas fiscais · P16 (tasks/P16.md). Só esta pasta pertence ao módulo; src/app/modules.ts é do integrador.
import { useMemo } from "react";
import type { ModuleDefinition } from "../../app/module-types.ts";
import { appEnv } from "../../app/env.ts";
import { useSession } from "../../app/session.tsx";
import { PageHeader, StatusBanner } from "../../components/ui/index.tsx";
import { createApiClient } from "../../lib/api/client.ts";
import { createDemoPort } from "./demoPort.ts";
import { FiscalPage } from "./FiscalPage.tsx";
import type { FiscalPort } from "./port.ts";
import { createServerPort } from "./serverPort.ts";
import "./fiscal.css";

function FiscalLayout() {
  const { state, tenantId, getAccessToken } = useSession();
  const port = useMemo<FiscalPort | null>(() => {
    if (state.status === "offline_demo" || !appEnv.supabase) return createDemoPort();
    if (!tenantId) return null;
    return createServerPort(createApiClient({ baseUrl: appEnv.supabase.url, publishableKey: appEnv.supabase.publishableKey, getAccessToken }), tenantId);
  }, [state.status, tenantId, getAccessToken]);
  if (!port) {
    return (
      <div className="tn-page-intro">
        <PageHeader id="fsc-no-tenant" title="Notas fiscais" />
        <StatusBanner tone="info">Selecione um negócio para emitir notas.</StatusBanner>
      </div>
    );
  }
  return <FiscalPage key={`${port.kind}:${tenantId ?? ""}`} port={port} />;
}

export const fiscalModule: ModuleDefinition = {
  id: "fiscal",
  owner: "P16",
  path: "notas",
  navLabel: "Notas fiscais",
  routes: [{ index: true, element: <FiscalLayout /> }],
};
