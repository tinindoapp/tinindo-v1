// Tela do Site e Google, carregada sob demanda pelo manifesto (module.tsx).
import { usePort } from "../../app/api.tsx";
import { useSession } from "../../app/session.tsx";
import { PageHeader, StatusBanner } from "../../components/ui/index.tsx";
import { createDemoPort } from "./demoPort.ts";
import type { PresencePort } from "./port.ts";
import { PresencePage } from "./PresencePage.tsx";
import { createServerPort } from "./serverPort.ts";

export function PresenceLayout() {
  const { tenantId } = useSession();
  const port = usePort<PresencePort>({ demo: createDemoPort, server: createServerPort });
  if (!port) {
    return (
      <div className="tn-page-intro">
        <PageHeader id="prs-no-tenant" title="Site e Google" />
        <StatusBanner tone="info">Selecione um negócio para cuidar do site.</StatusBanner>
      </div>
    );
  }
  return <PresencePage key={`${port.kind}:${tenantId ?? ""}`} port={port} />;
}
