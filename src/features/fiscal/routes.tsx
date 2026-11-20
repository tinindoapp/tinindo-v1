// Tela do módulo, carregada sob demanda pelo manifesto (module.tsx). Mesmo comportamento de antes do P53.
import { usePort } from "../../app/api.tsx";
import { useSession } from "../../app/session.tsx";
import { PageHeader, StatusBanner } from "../../components/ui/index.tsx";
import { createDemoPort } from "./demoPort.ts";
import { FiscalPage } from "./FiscalPage.tsx";
import type { FiscalPort } from "./port.ts";
import { createServerPort } from "./serverPort.ts";

export function FiscalLayout() {
  const { tenantId } = useSession();
  const port = usePort<FiscalPort>({ demo: createDemoPort, server: createServerPort });
  if (!port) {
    return (
      <div className="tn-page-intro">
        <PageHeader id="fsc-no-tenant" title="Notas fiscais" />
        <StatusBanner tone="info">Selecione um negócio para emitir notas.</StatusBanner>
      </div>
    );
  }
  return <FiscalPage key={`${port.kind}:${tenantId ?? ""}`} port={port} />;
}
