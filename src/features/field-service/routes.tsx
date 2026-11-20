// Tela do módulo, carregada sob demanda pelo manifesto (module.tsx). Mesmo comportamento de antes do P53.
import { usePort } from "../../app/api.tsx";
import { useSession } from "../../app/session.tsx";
import { Card, StatusBanner } from "../../components/ui/index.tsx";
import { createDemoPort } from "./demoPort.ts";
import type { FieldPort } from "./port.ts";
import { FieldPage } from "./FieldPage.tsx";
import { createServerPort } from "./serverPort.ts";

export function FieldLayout() {
  const { tenantId } = useSession();
  const port = usePort<FieldPort>({ demo: createDemoPort, server: createServerPort });
  if (!port) {
    return (
      <Card aria-labelledby="fs-no-tenant">
        <h1 id="fs-no-tenant">Domicílio</h1>
        <StatusBanner tone="info">Selecione um negócio para ver o atendimento a domicílio.</StatusBanner>
      </Card>
    );
  }
  return <FieldPage key={`${port.kind}:${tenantId ?? ""}`} port={port} />;
}
