// Módulo Relacionamento · P13 (tasks/P13.md). Só esta pasta pertence ao módulo; src/app/modules.ts é do integrador.
// Sem Supabase (demonstração offline) usa a emulação local, sempre rotulada; com Supabase, a função `lifecycle`.
// P49: a sub-rota `retorno` é a quinta aba da barra (decisão D2 b), com lembretes a mandar, quem não volta e lista de espera.
import { useEffect, useMemo, useState } from "react";
import type { ModuleDefinition } from "../../app/module-types.ts";
import { appEnv } from "../../app/env.ts";
import { useSession } from "../../app/session.tsx";
import { PageHeader, StatusBanner } from "../../components/ui/index.tsx";
import { ContextResponse } from "@contracts";
import { tenantA } from "@contracts/fixtures.ts";
import { createApiClient } from "../../lib/api/client.ts";
import { createDemoPort } from "./demoPort.ts";
import { LifecyclePage } from "./LifecyclePage.tsx";
import type { LifecyclePort } from "./port.ts";
import { createDemoReturnSource, createServerReturnSource, type ReturnSource } from "./retorno.ts";
import { RetornoPage } from "./RetornoPage.tsx";
import { createServerPort } from "./serverPort.ts";
import "./lifecycle.css";

function usePorts(): { demo: boolean; tenantId: string | null; port: LifecyclePort | null; source: ReturnSource | null } {
  const { state, tenantId, getAccessToken } = useSession();
  const demo = state.status === "offline_demo" || !appEnv.supabase;
  return useMemo(() => {
    if (demo) return { demo, tenantId, port: createDemoPort(), source: createDemoReturnSource() };
    if (!tenantId) return { demo, tenantId, port: null, source: null };
    const call = createApiClient({ baseUrl: appEnv.supabase!.url, publishableKey: appEnv.supabase!.publishableKey, getAccessToken });
    return { demo, tenantId, port: createServerPort(call, tenantId), source: createServerReturnSource(call, tenantId) };
  }, [demo, tenantId, getAccessToken]);
}

function RetornoLayout() {
  const { tenantId, port, source } = usePorts();
  if (!port || !source) {
    return (
      <div className="tn-stack">
        <PageHeader id="rt-no-tenant" title="Retorno" />
        <StatusBanner tone="info">Selecione um negócio para ver quem avisar e quem chamar de volta.</StatusBanner>
      </div>
    );
  }
  return <RetornoPage key={`${port.kind}:${tenantId ?? ""}`} port={port} source={source} />;
}

function LifecycleLayout() {
  const { getAccessToken } = useSession();
  const [timezone, setTimezone] = useState(tenantA.timezone);
  const { demo, tenantId, port } = usePorts();
  useEffect(() => {
    if (demo || !tenantId || !appEnv.supabase) return;
    const call = createApiClient({ baseUrl: appEnv.supabase.url, publishableKey: appEnv.supabase.publishableKey, getAccessToken });
    let alive = true;
    call("/context", ContextResponse, { tenantId }).then((r) => alive && setTimezone(r.data.timezone), () => undefined);
    return () => { alive = false; };
  }, [demo, tenantId, getAccessToken]);
  if (!port) {
    return (
      <div className="tn-stack">
        <PageHeader id="lc-no-tenant" title="Relacionamento" />
        <StatusBanner tone="info">Selecione um negócio para ver as réguas.</StatusBanner>
      </div>
    );
  }
  return <LifecyclePage key={`${port.kind}:${tenantId ?? ""}`} port={port} timezone={timezone} />;
}

export const lifecycleModule: ModuleDefinition = {
  id: "lifecycle",
  owner: "P13",
  path: "relacionamento",
  navLabel: "Relacionamento",
  routes: [
    { index: true, element: <LifecycleLayout /> },
    { path: "retorno", element: <RetornoLayout /> },
  ],
};
