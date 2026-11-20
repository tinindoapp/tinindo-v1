// Tela do módulo, carregada sob demanda pelo manifesto (module.tsx). Mesmo comportamento de antes do P53.
import { usePort } from "../../app/api.tsx";
import { useSession } from "../../app/session.tsx";
import { PageHeader, StatusBanner } from "../../components/ui/index.tsx";
import { createDemoPort } from "./demoPort.ts";
import type { RecurrencePort } from "./port.ts";
import { RecurrencePage } from "./RecurrencePage.tsx";
import { createServerPort } from "./serverPort.ts";

export function RecurrenceLayout() {
  const { tenantId } = useSession();
  const port = usePort<RecurrencePort>({ demo: createDemoPort, server: createServerPort });
  if (!port) {
    return (
      <div className="tn-page-intro">
        <PageHeader id="rc-no-tenant" title="Assinaturas" />
        <StatusBanner tone="info">Selecione um negócio para ver os planos.</StatusBanner>
      </div>
    );
  }
  return <RecurrencePage key={`${port.kind}:${tenantId ?? ""}`} port={port} />;
}
