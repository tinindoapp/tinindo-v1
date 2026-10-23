// Módulo Relacionamento · P13 (tasks/P13.md). Só esta pasta pertence ao módulo; src/app/modules.ts é do integrador.
// Sem Supabase (demonstração offline) usa a emulação local, sempre rotulada; com Supabase, a função `lifecycle`.
import { useEffect, useMemo, useState } from "react";
import type { ModuleDefinition } from "../../app/module-types.ts";
import { appEnv } from "../../app/env.ts";
import { useSession } from "../../app/session.tsx";
import { Card, StatusBanner } from "../../components/ui/index.tsx";
import { ContextResponse } from "@contracts";
import { tenantA } from "@contracts/fixtures.ts";
import { createApiClient } from "../../lib/api/client.ts";
import { createDemoPort } from "./demoPort.ts";
import { LifecyclePage } from "./LifecyclePage.tsx";
import type { LifecyclePort } from "./port.ts";
import { createServerPort } from "./serverPort.ts";
import "./lifecycle.css";

function LifecycleLayout() {
  const { state, tenantId, getAccessToken } = useSession();
  const [timezone, setTimezone] = useState(tenantA.timezone);
  const demo = state.status === "offline_demo" || !appEnv.supabase;
  const port = useMemo<LifecyclePort | null>(() => {
    if (demo) return createDemoPort();
    if (!tenantId) return null;
    return createServerPort(createApiClient({ baseUrl: appEnv.supabase!.url, publishableKey: appEnv.supabase!.publishableKey, getAccessToken }), tenantId);
  }, [demo, tenantId, getAccessToken]);
  useEffect(() => {
    if (demo || !tenantId || !appEnv.supabase) return;
    const call = createApiClient({ baseUrl: appEnv.supabase.url, publishableKey: appEnv.supabase.publishableKey, getAccessToken });
    let alive = true;
    call("/context", ContextResponse, { tenantId }).then((r) => alive && setTimezone(r.data.timezone), () => undefined);
    return () => { alive = false; };
  }, [demo, tenantId, getAccessToken]);
  if (!port) {
    return (
      <Card aria-labelledby="lc-no-tenant">
        <h1 id="lc-no-tenant">Relacionamento</h1>
        <StatusBanner tone="info">Selecione um negócio para ver as réguas.</StatusBanner>
      </Card>
    );
  }
  return <LifecyclePage key={`${port.kind}:${tenantId ?? ""}`} port={port} timezone={timezone} />;
}

export const lifecycleModule: ModuleDefinition = {
  id: "lifecycle",
  owner: "P13",
  path: "relacionamento",
  navLabel: "Relacionamento",
  routes: [{ index: true, element: <LifecycleLayout /> }],
};
