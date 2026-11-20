// Tela do módulo, carregada sob demanda pelo manifesto (module.tsx). Mesmo comportamento de antes do P53.
import { usePort } from "../../app/api.tsx";
import { useSession } from "../../app/session.tsx";
import { Card, StatusBanner } from "../../components/ui/index.tsx";
import { createDemoPort } from "./demoPort.ts";
import type { MaterialsPort } from "./port.ts";
import { MaterialsPage } from "./MaterialsPage.tsx";
import { createServerPort } from "./serverPort.ts";

export function MaterialsLayout() {
  const { tenantId } = useSession();
  const port = usePort<MaterialsPort>({ demo: createDemoPort, server: createServerPort });
  if (!port) {
    return (
      <Card aria-labelledby="mt-no-tenant">
        <h1 id="mt-no-tenant">Materiais</h1>
        <StatusBanner tone="info">Selecione um negócio para ver materiais e custos.</StatusBanner>
      </Card>
    );
  }
  return <MaterialsPage key={`${port.kind}:${tenantId ?? ""}`} port={port} />;
}
