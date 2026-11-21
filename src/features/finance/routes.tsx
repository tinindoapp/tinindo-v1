// Tela do módulo, carregada sob demanda pelo manifesto (module.tsx). Mesmo comportamento de antes do P53 (recado #148).
import { usePort } from "../../app/api.tsx";
import { useSession } from "../../app/session.tsx";
import { PageHeader, StatusBanner } from "../../components/ui/index.tsx";
import { getDemoPort } from "./demo.ts";
import { FinancePage, FinancePortProvider } from "./FinancePage.tsx";
import type { FinancePort } from "./port.ts";
import { createServerPort } from "./serverPort.ts";

const PORTS = { demo: getDemoPort, server: createServerPort };

export function FinanceLayout() {
  const { tenantId } = useSession();
  const port = usePort<FinancePort>(PORTS);
  if (!port) {
    return (
      <div className="tn-page-intro">
        <PageHeader id="fin-no-tenant" title="Caixa" />
        <StatusBanner tone="info">Selecione um negócio para ver o caixa.</StatusBanner>
      </div>
    );
  }
  return (
    <FinancePortProvider value={port}>
      <FinancePage key={`${port.kind}:${tenantId ?? ""}`} />
    </FinancePortProvider>
  );
}
