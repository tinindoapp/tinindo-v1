// Tela do módulo, carregada sob demanda pelo manifesto (module.tsx). Mesmo comportamento de antes do P53.
import { usePort } from "../../app/api.tsx";
import { useSession } from "../../app/session.tsx";
import { Card, StatusBanner } from "../../components/ui/index.tsx";
import { createDemoPort } from "./demoPort.ts";
import type { ResourcesPort } from "./port.ts";
import { ResourcesPage } from "./ResourcesPage.tsx";
import { createServerPort } from "./serverPort.ts";

export function ResourcesLayout() {
  const { tenantId } = useSession();
  const port = usePort<ResourcesPort>({ demo: createDemoPort, server: createServerPort });
  if (!port) {
    return (
      <Card aria-labelledby="rs-no-tenant">
        <h1 id="rs-no-tenant">Equipe</h1>
        <StatusBanner tone="info">Selecione um negócio para ver a equipe.</StatusBanner>
      </Card>
    );
  }
  return <ResourcesPage key={`${port.kind}:${tenantId ?? ""}`} port={port} />;
}
