// Módulo Pagamentos · P14 (tasks/P14.md). Só esta pasta pertence ao módulo; src/app/modules.ts e router.tsx são do integrador.
// Sem Supabase (demonstração offline) usa a emulação local, sempre rotulada; com Supabase, a função `payments`.
import { useEffect, useMemo, useState } from "react";
import type { RouteObject } from "react-router";
import type { ModuleDefinition } from "../../app/module-types.ts";
import { appEnv } from "../../app/env.ts";
import { useSession } from "../../app/session.tsx";
import { Card, StatusBanner } from "../../components/ui/index.tsx";
import { ContextResponse } from "@contracts";
import { tenantA } from "@contracts/fixtures.ts";
import { createApiClient } from "../../lib/api/client.ts";
import { createDemoLinkPort, createDemoPort } from "./demoPort.ts";
import { PayLinkPage } from "./PayLinkPage.tsx";
import { PaymentsPage } from "./PaymentsPage.tsx";
import type { PaymentLinkPort, PaymentsPort } from "./port.ts";
import { createServerLinkPort, createServerPort } from "./serverPort.ts";
import "./payments.css";

function PaymentsLayout() {
  const { state, tenantId, getAccessToken } = useSession();
  const [timezone, setTimezone] = useState(tenantA.timezone);
  const demo = state.status === "offline_demo" || !appEnv.supabase;
  const port = useMemo<PaymentsPort | null>(() => {
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
      <Card aria-labelledby="pay-no-tenant">
        <h1 id="pay-no-tenant">Pagamentos</h1>
        <StatusBanner tone="info">Selecione um negócio para ver as cobranças.</StatusBanner>
      </Card>
    );
  }
  return <PaymentsPage key={`${port.kind}:${tenantId ?? ""}`} port={port} timezone={timezone} />;
}

function PublicPay() {
  const port = useMemo<PaymentLinkPort>(() => {
    if (!appEnv.supabase) return createDemoLinkPort();
    // Link anônimo: sem token de sessão; o token da cobrança vai no corpo do POST.
    return createServerLinkPort(createApiClient({ baseUrl: appEnv.supabase.url, publishableKey: appEnv.supabase.publishableKey, getAccessToken: async () => null }));
  }, []);
  return <PayLinkPage port={port} />;
}

/** Rotas públicas, fora do shell autenticado (montadas em src/app/router.tsx). */
export const paymentsPublicRoutes: RouteObject[] = [{ path: "/pagar", element: <PublicPay /> }];

export const paymentsModule: ModuleDefinition = {
  id: "payments",
  owner: "P14",
  path: "pagamentos",
  navLabel: "Pagamentos",
  routes: [{ index: true, element: <PaymentsLayout /> }],
};
