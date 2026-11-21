// Módulo Privacidade · P57 (D26). Só esta pasta pertence ao módulo. Registro no app (src/app/modules.ts, o código
// "privacy" em ModuleCode de @contracts e o link em Conta) é do integrador: recado no handoff do P57.
// Sem Supabase (demonstração offline) usa a emulação local, sempre rotulada; com Supabase, a função `privacy`.
import { usePort } from "../../app/api.tsx";
import type { ModuleDefinition } from "../../app/module-types.ts";
import { useSession } from "../../app/session.tsx";
import { Card, StatusBanner } from "../../components/ui/index.tsx";
import { createDemoPort } from "./demoPort.ts";
import type { PrivacyPort } from "./port.ts";
import { PrivacyPage } from "./PrivacyPage.tsx";
import { createServerPort } from "./serverPort.ts";

// P53 (recado #146): o cliente da sessão, não um cliente próprio. Fábricas fora do componente (estáveis).
const PORTS = { demo: createDemoPort, server: createServerPort };

export function usePrivacyPort(): PrivacyPort | null {
  return usePort<PrivacyPort>(PORTS);
}

export function PrivacyLayout() {
  const port = usePrivacyPort();
  const { tenantId } = useSession();
  if (!port) {
    return (
      <Card aria-labelledby="privacy-no-tenant">
        <h1 id="privacy-no-tenant">Seus dados</h1>
        <StatusBanner tone="info">Selecione um negócio para baixar ou eliminar dados.</StatusBanner>
      </Card>
    );
  }
  return <PrivacyPage key={`${port.kind}:${tenantId ?? ""}`} port={port} />;
}

/**
 * Definição do módulo. `id` e `level` só passam a valer como ModuleDefinition quando o integrador acrescentar
 * "privacy" ao ModuleCode e ao MODULE_LEVELS de @contracts (proposta: `pilot`, ligado a partir de Conta).
 */
export const privacyModule = {
  id: "privacy",
  owner: "P57",
  level: "pilot",
  path: "privacidade",
  navLabel: "Seus dados",
  routes: [{ index: true, element: <PrivacyLayout /> }],
} as const satisfies Omit<ModuleDefinition, "id" | "level"> & { id: string; level: ModuleDefinition["level"] };
