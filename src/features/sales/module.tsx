// Módulo Orçamentos · P11 (tasks/P11.md). Só esta pasta pertence ao módulo; src/app/modules.ts é do integrador.
// Sem Supabase (demonstração offline) usa a emulação local, sempre rotulada; com Supabase, a função `sales`.
import { useMemo } from "react";
import type { ModuleDefinition } from "../../app/module-types.ts";
import { appEnv } from "../../app/env.ts";
import { useSession } from "../../app/session.tsx";
import { PageHeader, StatusBanner } from "../../components/ui/index.tsx";
import { createApiClient } from "../../lib/api/client.ts";
import { createDemoPort } from "./demoPort.ts";
import { usePublishedSlug } from "./owner-slug.ts";
import type { SalesPort } from "./port.ts";
import { QuotesPage, SalesPortProvider } from "./QuotesPage.tsx";
import { createServerPort } from "./serverPort.ts";
import "./sales.css";

function SalesLayout() {
  const { state, tenantId, getAccessToken } = useSession();
  // Quem manda o orçamento: o nome entra na mensagem pronta e o endereço publicado, no caminho do link.
  const slug = usePublishedSlug();
  const memberships = state.status === "signed_in" || state.status === "offline_demo" ? state.memberships : [];
  const name = memberships.find((m) => m.tenant_id === tenantId)?.tenant_name ?? null;
  const port = useMemo<SalesPort | null>(() => {
    if (state.status === "offline_demo" || !appEnv.supabase) return createDemoPort();
    if (!tenantId) return null;
    return createServerPort(createApiClient({ baseUrl: appEnv.supabase.url, publishableKey: appEnv.supabase.publishableKey, getAccessToken }), tenantId);
  }, [state.status, tenantId, getAccessToken]);
  if (!port) {
    return (
      <div className="tn-stack">
        <PageHeader id="qt-no-tenant" title="Orçamentos" />
        <StatusBanner tone="info">Selecione um negócio para ver os orçamentos.</StatusBanner>
      </div>
    );
  }
  return (
    <SalesPortProvider value={port}>
      <QuotesPage key={`${port.kind}:${tenantId ?? ""}`} business={{ name, slug }} />
    </SalesPortProvider>
  );
}

// Importa e reexporta (em vez de `export … from`): tests/e2e/foundation/rotas.ts segue imports para ler as rotas.
import { salesPublicRoutes } from "./public-routes.tsx";
export { salesPublicRoutes };

export const salesModule: ModuleDefinition = {
  id: "sales",
  owner: "P11",
  path: "orcamentos",
  navLabel: "Orçamentos",
  routes: [{ index: true, element: <SalesLayout /> }],
};
