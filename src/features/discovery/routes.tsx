// Telas do Diretório, carregadas sob demanda pelo manifesto (module.tsx).
import { useMemo } from "react";
import { publicCall, usePort } from "../../app/api.tsx";
import { useSession } from "../../app/session.tsx";
import { PageHeader, StatusBanner } from "../../components/ui/index.tsx";
import { createDemoDirectoryPort, createDemoPort } from "./demoPort.ts";
import { DiscoverySettingsPage, PublicDirectoryPage } from "./DirectoryPages.tsx";
import type { DirectoryPort, DiscoveryPort } from "./port.ts";
import { createServerDirectoryPort, createServerPort } from "./serverPort.ts";

export function SettingsLayout() {
  const { tenantId } = useSession();
  const port = usePort<DiscoveryPort>({ demo: createDemoPort, server: createServerPort });
  if (!port) {
    return (
      <div className="tn-page-intro">
        <PageHeader id="dir-no-tenant" title="Diretório" />
        <StatusBanner tone="info">Selecione um negócio.</StatusBanner>
      </div>
    );
  }
  return <DiscoverySettingsPage key={`${port.kind}:${tenantId ?? ""}`} port={port} />;
}

/** Diretório público: anônimo, sem sessão. */
export function PublicDirectory() {
  const port = useMemo<DirectoryPort>(() => {
    const call = publicCall();
    return call ? createServerDirectoryPort(call) : createDemoDirectoryPort();
  }, []);
  return <PublicDirectoryPage port={port} />;
}
