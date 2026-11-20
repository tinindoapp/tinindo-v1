// Telas do módulo, carregadas sob demanda pelo manifesto (module.tsx; P53, recado #148). Cliente da sessão (usePort) e
// fuso do negócio da sessão (useBusinessTimezone): nada de começar com o fuso da fixture e trocar depois.
import { BusinessPending, useApi, useBusinessTimezone } from "../../app/api.tsx";
import { PageHeader, StatusBanner } from "../../components/ui/index.tsx";
import { useMemo } from "react";
import { createDemoPort } from "./demoPort.ts";
import { LifecyclePage } from "./LifecyclePage.tsx";
import type { LifecyclePort } from "./port.ts";
import { createDemoReturnSource, createServerReturnSource, type ReturnSource } from "./retorno.ts";
import { RetornoPage } from "./RetornoPage.tsx";
import { createServerPort } from "./serverPort.ts";

function usePorts(): { tenantId: string | null; port: LifecyclePort | null; source: ReturnSource | null } {
  const { demo, call, tenantId } = useApi();
  return useMemo(() => {
    if (demo) return { tenantId, port: createDemoPort(), source: createDemoReturnSource() };
    if (!tenantId || !call) return { tenantId, port: null, source: null };
    return { tenantId, port: createServerPort(call, tenantId), source: createServerReturnSource(call, tenantId) };
  }, [demo, call, tenantId]);
}

export function RetornoLayout() {
  const { tenantId, port, source } = usePorts();
  if (!port || !source) {
    return (
      <div className="tn-stack">
        <PageHeader id="rt-no-tenant" title="Retorno" />
        <StatusBanner tone="info">Selecione um negócio para ver quem avisar e quem chamar de volta.</StatusBanner>
      </div>
    );
  }
  return <RetornoPage key={`${port.kind}:${tenantId ?? ""}`} port={port} source={source} />;
}

export function LifecycleLayout() {
  const { tenantId, port } = usePorts();
  const { timezone, failed, retry } = useBusinessTimezone();
  if (!port) {
    return (
      <div className="tn-stack">
        <PageHeader id="lc-no-tenant" title="Relacionamento" />
        <StatusBanner tone="info">Selecione um negócio para ver as réguas.</StatusBanner>
      </div>
    );
  }
  if (!timezone) return <BusinessPending failed={failed} retry={retry} />;
  return <LifecyclePage key={`${port.kind}:${tenantId ?? ""}`} port={port} timezone={timezone} />;
}
