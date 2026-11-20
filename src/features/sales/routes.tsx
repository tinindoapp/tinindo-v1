// Tela de Orçamentos, carregada sob demanda pelo manifesto (module.tsx).
import { usePort } from "../../app/api.tsx";
import { useSession } from "../../app/session.tsx";
import { PageHeader, StatusBanner } from "../../components/ui/index.tsx";
import { createDemoPort } from "./demoPort.ts";
import { usePublishedSlug } from "./owner-slug.ts";
import type { SalesPort } from "./port.ts";
import { QuotesPage, SalesPortProvider } from "./QuotesPage.tsx";
import { createServerPort } from "./serverPort.ts";

export function SalesLayout() {
  const { state, tenantId } = useSession();
  // Quem manda o orçamento: o nome entra na mensagem pronta e o endereço publicado, no caminho do link.
  const slug = usePublishedSlug();
  const memberships = state.status === "signed_in" || state.status === "offline_demo" ? state.memberships : [];
  const name = memberships.find((m) => m.tenant_id === tenantId)?.tenant_name ?? null;
  const port = usePort<SalesPort>({ demo: createDemoPort, server: createServerPort });
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
