// Módulo Pagamentos · P14 (tasks/P14.md). Só esta pasta pertence ao módulo; src/app/modules.ts e router.tsx são do integrador.
// Sem Supabase (demonstração offline) usa a emulação local, sempre rotulada; com Supabase, a função `payments`.
import { useEffect, useMemo, useState } from "react";
import type { ModuleDefinition } from "../../app/module-types.ts";
import { appEnv } from "../../app/env.ts";
import { useSession } from "../../app/session.tsx";
import { PageHeader, StatusBanner } from "../../components/ui/index.tsx";
import { ContextResponse } from "@contracts";
import { tenantA } from "@contracts/fixtures.ts";
import { createApiClient } from "../../lib/api/client.ts";
import { createDemoPort } from "./demoPort.ts";
import { usePublishedSlug } from "./owner-slug.ts";
import { PaymentsPage } from "./PaymentsPage.tsx";
import type { PaymentsPort } from "./port.ts";
import { createServerPort } from "./serverPort.ts";
import "./payments.css";

function PaymentsLayout() {
  const { state, tenantId, getAccessToken } = useSession();
  const [timezone, setTimezone] = useState(tenantA.timezone);
  // Quem manda a cobrança: o nome entra na mensagem pronta e o endereço publicado, no caminho do link.
  const slug = usePublishedSlug();
  const memberships = state.status === "signed_in" || state.status === "offline_demo" ? state.memberships : [];
  const name = memberships.find((m) => m.tenant_id === tenantId)?.tenant_name ?? null;
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
      <div className="tn-page-intro">
        <PageHeader id="pay-no-tenant" title="Pagamentos" />
        <StatusBanner tone="info">Selecione um negócio para ver as cobranças.</StatusBanner>
      </div>
    );
  }
  return <PaymentsPage key={`${port.kind}:${tenantId ?? ""}`} port={port} timezone={timezone} business={{ name, slug }} />;
}

export { paymentsPublicRoutes } from "./public-routes.tsx";

export const paymentsModule: ModuleDefinition = {
  id: "payments",
  owner: "P14",
  path: "pagamentos",
  navLabel: "Pagamentos",
  routes: [{ index: true, element: <PaymentsLayout /> }],
};
