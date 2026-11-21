// Telas de Plano e serviços e da Operação Tinindo, carregadas sob demanda pelo manifesto (module.tsx).
import { usePort, useSessionPort } from "../../app/api.tsx";
import { OperatorGate } from "../../app/OperatorGate.tsx";
import { useSession } from "../../app/session.tsx";
import { useApi } from "../../app/api.tsx";
import { supabase } from "../../lib/supabase.ts";
import { now } from "../../lib/time.ts";
import { useMemo } from "react";
import { Card, StatusBanner } from "../../components/ui/index.tsx";
import { createDemoOpsPort, createDemoPort } from "./demoPort.ts";
import { createDemoHealthPort, createServerHealthPort, type OpsHealthPort } from "./health.ts";
import { HealthPage } from "./HealthPage.tsx";
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

/** Saúde da operação (P58): leitura única pela Data API (public.ops_health); o banco recusa quem não é da equipe. */
export function OpsHealthLayout() {
  return (
    <OperatorGate title="Saúde da operação" headingId="ops-health-title">
      <OpsHealthScreen />
    </OperatorGate>
  );
}

function OpsHealthScreen() {
  const { demo } = useApi();
  const port = useMemo<OpsHealthPort>(() => (demo || !supabase ? createDemoHealthPort(now) : createServerHealthPort(supabase)), [demo]);
  return <HealthPage key={port.kind} port={port} />;
}
