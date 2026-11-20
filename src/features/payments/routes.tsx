// Telas de Pagamentos dentro do shell, carregadas sob demanda pelo manifesto (module.tsx).
// Sem Supabase (demonstração offline) usa a emulação local, sempre rotulada; com Supabase, a função `payments`.
import { BusinessPending, useBusinessTimezone, usePort } from "../../app/api.tsx";
import { useSession } from "../../app/session.tsx";
import { PageHeader, StatusBanner } from "../../components/ui/index.tsx";
import { createDemoPort } from "./demoPort.ts";
import { usePublishedSlug } from "./owner-slug.ts";
import { PaymentsPage } from "./PaymentsPage.tsx";
import type { PaymentsPort } from "./port.ts";
import { createServerPort } from "./serverPort.ts";

export function PaymentsLayout() {
  const { state, tenantId } = useSession();
  const { timezone, failed, retry } = useBusinessTimezone();
  // Quem manda a cobrança: o nome entra na mensagem pronta e o endereço publicado, no caminho do link.
  const slug = usePublishedSlug();
  const memberships = state.status === "signed_in" || state.status === "offline_demo" ? state.memberships : [];
  const name = memberships.find((m) => m.tenant_id === tenantId)?.tenant_name ?? null;
  const port = usePort<PaymentsPort>({ demo: createDemoPort, server: createServerPort });
  if (!port) {
    return (
      <div className="tn-page-intro">
        <PageHeader id="pay-no-tenant" title="Pagamentos" />
        <StatusBanner tone="info">Selecione um negócio para ver as cobranças.</StatusBanner>
      </div>
    );
  }
  if (!timezone) return <BusinessPending failed={failed} retry={retry} />;
  return <PaymentsPage key={`${port.kind}:${tenantId ?? ""}`} port={port} timezone={timezone} business={{ name, slug }} />;
}
