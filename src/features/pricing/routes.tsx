// Tela de Preços, carregada sob demanda pelo manifesto (module.tsx).
import { usePort } from "../../app/api.tsx";
import { useSession } from "../../app/session.tsx";
import { PageHeader, StatusBanner } from "../../components/ui/index.tsx";
import { createDemoPort } from "./demoPort.ts";
import type { PricingPort } from "./port.ts";
import { PricingPage, PricingPortProvider } from "./PricingPage.tsx";
import { createServerPort } from "./serverPort.ts";

let demoPort: PricingPort | null = null;
/** Uma emulação por carregamento de página: as mudanças valem enquanto a aba estiver aberta. */
function getDemoPort(): PricingPort {
  demoPort ??= createDemoPort();
  return demoPort;
}

export function PricingLayout() {
  const { tenantId } = useSession();
  const port = usePort<PricingPort>({ demo: getDemoPort, server: createServerPort });
  if (!port) {
    return (
      <section aria-labelledby="pr-no-tenant" className="tn-pr">
        <PageHeader id="pr-no-tenant" title="Preços" />
        <StatusBanner tone="info">Selecione um negócio para ver os preços.</StatusBanner>
      </section>
    );
  }
  return (
    <PricingPortProvider value={port}>
      <PricingPage key={`${port.kind}:${tenantId ?? ""}`} />
    </PricingPortProvider>
  );
}
