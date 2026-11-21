// Tela do módulo, carregada sob demanda pelo manifesto (module.tsx). Mesmo comportamento de antes do P53 (recado #148).
import { useLocation } from "react-router";
import { usePort } from "../../app/api.tsx";
import { useSession } from "../../app/session.tsx";
import { PageHeader, StatusBanner } from "../../components/ui/index.tsx";
import { AgentPage, AgentPortProvider, type InitialDraft } from "./AgentPage.tsx";
import { createDemoPort } from "./demoPort.ts";
import type { AgentPort } from "./port.ts";
import { createServerPort } from "./serverPort.ts";

const PORTS = { demo: createDemoPort, server: createServerPort };

export function AgentLayout() {
  const { tenantId } = useSession();
  // "Ajustar o texto com o assistente" de outras telas chega como estado da navegação (fica no navegador, fora da URL).
  const initialDraft = (useLocation().state as { draft?: InitialDraft } | null)?.draft;
  const port = usePort<AgentPort>(PORTS);
  if (!port) {
    return (
      <div className="tn-page-intro">
        <PageHeader id="ag-no-tenant" title="Assistente" />
        <StatusBanner tone="info">Selecione um negócio para usar o assistente.</StatusBanner>
      </div>
    );
  }
  return (
    <AgentPortProvider value={port}>
      {/* Trocar de negócio recomeça a conversa: nada de um negócio vira contexto de outro. */}
      <AgentPage key={`${port.kind}:${tenantId ?? ""}`} initialDraft={initialDraft} />
    </AgentPortProvider>
  );
}
