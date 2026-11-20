// Tela do módulo, carregada sob demanda pelo manifesto (module.tsx). Mesmo comportamento de antes do P53.
import { usePort } from "../../app/api.tsx";
import { useSession } from "../../app/session.tsx";
import { PageHeader, StatusBanner } from "../../components/ui/index.tsx";
import { createDemoPort } from "./demoPort.ts";
import type { CampaignsPort } from "./port.ts";
import { CampaignsPage } from "./CampaignsPage.tsx";
import { createServerPort } from "./serverPort.ts";

export function CampaignsLayout() {
  const { tenantId } = useSession();
  const port = usePort<CampaignsPort>({ demo: createDemoPort, server: createServerPort });
  if (!port) {
    return (
      <div className="tn-page-intro">
        <PageHeader id="cp-no-tenant" title="Campanhas" />
        <StatusBanner tone="info">Selecione um negócio para ver as campanhas.</StatusBanner>
      </div>
    );
  }
  return <CampaignsPage key={`${port.kind}:${tenantId ?? ""}`} port={port} />;
}
