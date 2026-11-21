// Telas de Resultado e do custo por cliente, carregadas sob demanda pelo manifesto (module.tsx).
// O custo por cliente fica em /app/resultado/custo, fora do menu: o banco decide quem é operador; quem não é da equipe
// (sinal `isOperator` da sessão, recado #88) vê só o aviso, sem chamar o servidor.
import { usePort, useSessionPort } from "../../app/api.tsx";
import { OperatorGate } from "../../app/OperatorGate.tsx";
import { useSession } from "../../app/session.tsx";
import { Card, LinkButton, PageHeader, StatusBanner } from "../../components/ui/index.tsx";
import { now } from "../../lib/time.ts";
import { CostPage } from "./CostPage.tsx";
import { createDemoCostPort, createDemoPort } from "./demoPort.ts";
import type { AnalyticsPort, CostPort } from "./port.ts";
import { ResultPage } from "./ResultPage.tsx";
import { createServerCostPort, createServerPort } from "./serverPort.ts";
import { ForecastPage } from "./ForecastPage.tsx";
import { createDemoForecastPort, createServerForecastPort, type ForecastPort } from "./forecastPort.ts";
import { ReportPage } from "./ReportPage.tsx";
import { createDemoReportPort, createServerReportPort, type ReportPort } from "./reportPort.ts";
import { UsageSettingsCard } from "./UsageSettingsCard.tsx";
import { createDemoUsagePort, createServerUsagePort, type UsagePort } from "./usagePort.ts";

export function ResultLayout() {
  const { tenantId } = useSession();
  const port = usePort<AnalyticsPort>({ demo: createDemoPort, server: createServerPort });
  const usage = usePort<UsagePort>({ demo: createDemoUsagePort, server: createServerUsagePort });
  if (!port) {
    return (
      <div className="tn-page-intro">
        <PageHeader id="an-no-tenant" title="Resultado" />
        <StatusBanner tone="info">Selecione um negócio para ver os indicadores.</StatusBanner>
      </div>
    );
  }
  return (
    <>
      <ResultPage key={`${port.kind}:${tenantId ?? ""}`} port={port} />
      <Card aria-labelledby="an-report-link">
        <h2 id="an-report-link">Sua semana e seu mês</h2>
        <p className="tn-muted">Atendimentos, recebido, faltas, quem voltou e os horários, para guardar ou compartilhar.</p>
        <LinkButton to="/app/resultado/relatorio" variant="secondary">Ver o relatório</LinkButton>
        <LinkButton to="/app/resultado/previsao" variant="secondary">Ver a previsão da próxima semana</LinkButton>
      </Card>
      <UsageSettingsCard key={`usage:${port.kind}:${tenantId ?? ""}`} port={usage!} />
    </>
  );
}

const demoNow = () => new Date(Date.parse("2026-10-20T12:00:00Z"));

export function ReportLayout() {
  const { tenantId, business } = useSession();
  const port = usePort<ReportPort>({ demo: createDemoReportPort, server: createServerReportPort });
  if (!port) {
    return (
      <div className="tn-page-intro">
        <PageHeader id="an-report-title" title="Sua semana" />
        <StatusBanner tone="info">Selecione um negócio para ver o relatório.</StatusBanner>
      </div>
    );
  }
  const name = business.status === "ready" ? business.business.name : null;
  return <ReportPage key={`${port.kind}:${tenantId ?? ""}`} port={port} business={name} />;
}

export function CostLayout() {
  return (
    <OperatorGate title="Custo por cliente" headingId="cost-title">
      <CostScreen />
    </OperatorGate>
  );
}

function CostScreen() {
  const port = useSessionPort<CostPort>({ demo: createDemoCostPort, server: createServerCostPort });
  return <CostPage port={port} now={port.kind === "demo" ? demoNow : now} />;
}

export function ForecastLayout() {
  const { tenantId } = useSession();
  const port = usePort<ForecastPort>({ demo: createDemoForecastPort, server: createServerForecastPort });
  if (!port) {
    return (
      <div className="tn-page-intro">
        <PageHeader id="an-forecast-title" title="Próxima semana" />
        <StatusBanner tone="info">Selecione um negócio para ver a previsão.</StatusBanner>
      </div>
    );
  }
  return <ForecastPage key={`${port.kind}:${tenantId ?? ""}`} port={port} />;
}
