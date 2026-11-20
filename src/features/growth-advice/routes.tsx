// Tela de Metas e sugestões, carregada sob demanda pelo manifesto (module.tsx).
import { useSession } from "../../app/session.tsx";
import { PageHeader, StatusBanner } from "../../components/ui/index.tsx";
import { GoalsPage } from "./GoalsPage.tsx";
import { useGrowthAdvicePort } from "./use-port.ts";

export function GoalsLayout() {
  const { tenantId } = useSession();
  const port = useGrowthAdvicePort();
  if (!port) {
    return (
      <div className="tn-page-intro">
        <PageHeader id="ga-no-tenant" title="Metas e sugestões" />
        <StatusBanner tone="info">Selecione um negócio para ver as metas.</StatusBanner>
      </div>
    );
  }
  return <GoalsPage key={`${port.kind}:${tenantId ?? ""}`} port={port} />;
}
