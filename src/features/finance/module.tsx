// Módulo Caixa · P07 (tasks/P07.md). Só esta pasta pertence ao módulo; src/app/modules.ts é do integrador.
// Sem Supabase (demonstração offline) usa a emulação local, sempre rotulada; com Supabase, a função `finance`.
import { useMemo } from "react";
import type { ModuleDefinition } from "../../app/module-types.ts";
import { appEnv } from "../../app/env.ts";
import { useSession } from "../../app/session.tsx";
import { Card, StatusBanner } from "../../components/ui/index.tsx";
import { createApiClient } from "../../lib/api/client.ts";
import { completedVisits } from "../../lib/demo/journey.ts";
import { createDemoPort } from "./demoPort.ts";
import { FinancePage, FinancePortProvider } from "./FinancePage.tsx";
import type { FinancePort } from "./port.ts";
import { createServerPort } from "./serverPort.ts";
import "./finance.css";

let demoPort: FinancePort | null = null;
/** Uma emulação por carregamento de página: as mudanças valem enquanto a aba estiver aberta. */
export function getDemoPort(): FinancePort {
  // Atendimentos concluídos na Agenda da mesma aba aparecem aqui como "sem cobrança" (nunca como recebidos).
  demoPort ??= createDemoPort({ visits: completedVisits });
  return demoPort;
}
/** Só para testes. */
export function resetDemoPort() {
  demoPort = null;
}

function FinanceLayout() {
  const { state, tenantId, getAccessToken } = useSession();
  const port = useMemo<FinancePort | null>(() => {
    if (state.status === "offline_demo" || !appEnv.supabase) return getDemoPort();
    if (!tenantId) return null;
    const call = createApiClient({ baseUrl: appEnv.supabase.url, publishableKey: appEnv.supabase.publishableKey, getAccessToken });
    return createServerPort(call, tenantId);
  }, [state.status, tenantId, getAccessToken]);

  if (!port) {
    return (
      <Card aria-labelledby="fin-no-tenant">
        <h1 id="fin-no-tenant">Caixa</h1>
        <StatusBanner tone="info">Selecione um negócio para ver o caixa.</StatusBanner>
      </Card>
    );
  }
  return (
    <FinancePortProvider value={port}>
      <FinancePage key={`${port.kind}:${tenantId ?? ""}`} />
    </FinancePortProvider>
  );
}

export const financeModule: ModuleDefinition = {
  id: "finance",
  owner: "P07",
  path: "caixa",
  navLabel: "Caixa",
  routes: [{ index: true, element: <FinanceLayout /> }],
};
