// Tela do módulo, carregada sob demanda pelo manifesto (module.tsx). Mesmo comportamento de antes do P53.
import { usePort } from "../../app/api.tsx";
import { useSession } from "../../app/session.tsx";
import { Card, StatusBanner } from "../../components/ui/index.tsx";
import { createDemoPort } from "./demoPort.ts";
import type { AccountsPort } from "./port.ts";
import { AccountsPage } from "./AccountsPage.tsx";
import { createServerPort } from "./serverPort.ts";

export function AccountsLayout() {
  const { tenantId } = useSession();
  const port = usePort<AccountsPort>({ demo: createDemoPort, server: createServerPort });
  if (!port) {
    return (
      <Card aria-labelledby="acc-no-tenant">
        <h1 id="acc-no-tenant">Contas</h1>
        <StatusBanner tone="info">Selecione um negócio para ver as contas.</StatusBanner>
      </Card>
    );
  }
  return <AccountsPage key={`${port.kind}:${tenantId ?? ""}`} port={port} />;
}
