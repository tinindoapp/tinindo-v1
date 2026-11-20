// Telas da Lista de espera, carregadas sob demanda pelo manifesto (module.tsx).
import { useMemo } from "react";
import { useSearchParams } from "react-router";
import { publicCall, usePort } from "../../app/api.tsx";
import { useSession } from "../../app/session.tsx";
import { PageHeader, StatusBanner } from "../../components/ui/index.tsx";
import { createDemoLinkPort, createDemoPort } from "./demoPort.ts";
import { OfferPage } from "./OfferPage.tsx";
import type { OfferLinkPort, WaitlistPort } from "./port.ts";
import { createServerLinkPort, createServerPort } from "./serverPort.ts";
import { WaitlistPage, WaitlistPortProvider } from "./WaitlistPage.tsx";

export function WaitlistLayout() {
  const { tenantId } = useSession();
  // Horário liberado por um cancelamento (`?vaga=<início ISO>`): a tela abre com ele em destaque.
  const [params] = useSearchParams();
  const vaga = params.get("vaga");
  const port = usePort<WaitlistPort>({ demo: createDemoPort, server: createServerPort });
  if (!port) {
    return (
      <section aria-labelledby="wl-no-tenant" className="tn-wl">
        <PageHeader id="wl-no-tenant" title="Lista de espera" />
        <StatusBanner tone="info">Selecione um negócio para ver a lista de espera.</StatusBanner>
      </section>
    );
  }
  return (
    <WaitlistPortProvider value={port}>
      <WaitlistPage key={`${port.kind}:${tenantId ?? ""}:${vaga ?? ""}`} vaga={vaga} />
    </WaitlistPortProvider>
  );
}

/** Link anônimo da oferta: sem token de sessão; o token da oferta vai no corpo do POST. */
export function PublicOffer() {
  const port = useMemo<OfferLinkPort>(() => {
    const call = publicCall();
    return call ? createServerLinkPort(call) : createDemoLinkPort();
  }, []);
  return <OfferPage port={port} />;
}
