// Módulo Indicações · P21 (tasks/P21.md). Só esta pasta pertence ao módulo; src/app/modules.ts é do integrador.
import { useMemo } from "react";
import type { ModuleDefinition } from "../../app/module-types.ts";
import { appEnv } from "../../app/env.ts";
import { useSession } from "../../app/session.tsx";
import { PageHeader, StatusBanner } from "../../components/ui/index.tsx";
import { createApiClient } from "../../lib/api/client.ts";
import { createDemoPort } from "./demoPort.ts";
import type { ReferralsPort } from "./port.ts";
import { ReferralsPage } from "./ReferralsPage.tsx";
import { createServerPort } from "./serverPort.ts";
import "./referrals.css";

function ReferralsLayout() {
  const { state, tenantId, getAccessToken } = useSession();
  const port = useMemo<ReferralsPort | null>(() => {
    if (state.status === "offline_demo" || !appEnv.supabase) return createDemoPort();
    if (!tenantId) return null;
    return createServerPort(createApiClient({ baseUrl: appEnv.supabase.url, publishableKey: appEnv.supabase.publishableKey, getAccessToken }), tenantId);
  }, [state.status, tenantId, getAccessToken]);
  if (!port) {
    return (
      <div className="tn-page-intro">
        <PageHeader id="ref-no-tenant" title="Indicações" />
        <StatusBanner tone="info">Selecione um negócio para ver as indicações.</StatusBanner>
      </div>
    );
  }
  return <ReferralsPage key={`${port.kind}:${tenantId ?? ""}`} port={port} />;
}

export const referralsModule: ModuleDefinition = {
  id: "referrals",
  owner: "P21",
  path: "indicacoes",
  navLabel: "Indicações",
  routes: [{ index: true, element: <ReferralsLayout /> }],
};
