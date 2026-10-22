// Módulo Canal · P12 (tasks/P12.md). Só esta pasta pertence ao módulo; src/app/modules.ts é do integrador.
// Sem Supabase (demonstração offline) usa a emulação local, sempre rotulada; com Supabase, a função `messaging`.
import { useEffect, useMemo, useState } from "react";
import type { ModuleDefinition } from "../../app/module-types.ts";
import { appEnv } from "../../app/env.ts";
import { useSession } from "../../app/session.tsx";
import { Card, StatusBanner } from "../../components/ui/index.tsx";
import { ContextResponse } from "@contracts";
import { tenantA } from "@contracts/fixtures.ts";
import { createApiClient } from "../../lib/api/client.ts";
import { createDemoPort } from "./demoPort.ts";
import { InboxPage } from "./InboxPage.tsx";
import type { MessagingPort } from "./port.ts";
import { createServerPort } from "./serverPort.ts";
import { SimulatorPage } from "./SimulatorPage.tsx";
import "./messaging.css";

function usePort(): { port: MessagingPort | null; timezone: string; tenantId: string | null } {
  const { state, tenantId, getAccessToken } = useSession();
  const [timezone, setTimezone] = useState(tenantA.timezone);
  const demo = state.status === "offline_demo" || !appEnv.supabase;
  const port = useMemo<MessagingPort | null>(() => {
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
  return { port, timezone, tenantId };
}

function NoTenant({ title }: { title: string }) {
  return (
    <Card aria-labelledby="msg-no-tenant">
      <h1 id="msg-no-tenant">{title}</h1>
      <StatusBanner tone="info">Selecione um negócio para ver o canal.</StatusBanner>
    </Card>
  );
}

function InboxLayout() {
  const { port, timezone, tenantId } = usePort();
  if (!port) return <NoTenant title="Mensagens" />;
  return <InboxPage key={`${port.kind}:${tenantId ?? ""}`} port={port} timezone={timezone} />;
}

function SimulatorLayout() {
  const { port, timezone, tenantId } = usePort();
  if (!port) return <NoTenant title="Simulador do telefone" />;
  return <SimulatorPage key={`${port.kind}:${tenantId ?? ""}`} port={port} timezone={timezone} />;
}

export const messagingModule: ModuleDefinition = {
  id: "messaging",
  owner: "P12",
  path: "mensagens",
  navLabel: "Mensagens",
  routes: [
    { index: true, element: <InboxLayout /> },
    { path: "simulador", element: <SimulatorLayout /> },
  ],
};
