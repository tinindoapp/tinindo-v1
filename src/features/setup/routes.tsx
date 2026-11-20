// Tela da Configuração, carregada sob demanda pelo manifesto (module.tsx).
import { useSession } from "../../app/session.tsx";
import { Card, StatusBanner } from "../../components/ui/index.tsx";
import { SetupPage } from "./SetupPage.tsx";
import { useSetupPort } from "./use-port.ts";

export function SetupLayout() {
  const port = useSetupPort();
  const { tenantId } = useSession();
  if (!port) {
    return (
      <Card aria-labelledby="setup-no-tenant">
        <h1 id="setup-no-tenant">Configuração</h1>
        <StatusBanner tone="info">Selecione um negócio para ver os passos da configuração.</StatusBanner>
      </Card>
    );
  }
  return <SetupPage key={`${port.kind}:${tenantId ?? ""}`} port={port} />;
}
