// Tela do módulo, carregada sob demanda pelo manifesto (module.tsx). Mesmo comportamento de antes do P53.
import { usePort } from "../../app/api.tsx";
import { useSession } from "../../app/session.tsx";
import { PageHeader, StatusBanner } from "../../components/ui/index.tsx";
import { createDemoPort } from "./demoPort.ts";
import type { ReferralsPort } from "./port.ts";
import { ReferralsPage } from "./ReferralsPage.tsx";
import { createServerPort } from "./serverPort.ts";

export function ReferralsLayout() {
  const { tenantId } = useSession();
  const port = usePort<ReferralsPort>({ demo: createDemoPort, server: createServerPort });
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
