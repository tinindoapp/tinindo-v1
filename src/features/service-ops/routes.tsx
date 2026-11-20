// Telas de Plano e serviços e da Operação Tinindo, carregadas sob demanda pelo manifesto (module.tsx).
import { usePort, useSessionPort } from "../../app/api.tsx";
import { OperatorGate } from "../../app/OperatorGate.tsx";
import { useSession } from "../../app/session.tsx";
import { Card, StatusBanner } from "../../components/ui/index.tsx";
import { createDemoOpsPort, createDemoPort } from "./demoPort.ts";
import { OpsPage } from "./OpsPage.tsx";
import type { OpsPort, ServiceOpsPort } from "./port.ts";
import { createServerOpsPort, createServerPort } from "./serverPort.ts";
import { ServiceOpsPortProvider, ServicesPage } from "./ServicesPage.tsx";

export function ServicesLayout() {
  const { tenantId } = useSession();
  const port = usePort<ServiceOpsPort>({ demo: createDemoPort, server: createServerPort });
  if (!port) {
    return (
      <Card aria-labelledby="svc-no-tenant">
        <h1 id="svc-no-tenant">Plano e serviços</h1>
        <StatusBanner tone="info">Selecione um negócio para ver o plano e os serviços.</StatusBanner>
      </Card>
    );
  }
  return (
    <ServiceOpsPortProvider value={port}>
      <ServicesPage key={`${port.kind}:${tenantId ?? ""}`} />
    </ServiceOpsPortProvider>
  );
}

export function OpsLayout() {
  return (
    <OperatorGate title="Operação Tinindo" headingId="ops-title">
      <OpsScreen />
    </OperatorGate>
  );
}

function OpsScreen() {
  const port = useSessionPort<OpsPort>({ demo: createDemoOpsPort, server: createServerOpsPort });
  return <OpsPage key={port.kind} port={port} />;
}
