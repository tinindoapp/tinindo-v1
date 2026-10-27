// Página pública do site (P17): só a versão publicada. A página indexável servida pelo backend tem o mesmo conteúdo;
// esta é a do app (link compartilhável e demonstração).
import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { PageHeader, StatusBanner } from "../../components/ui/index.tsx";
import type { PublicSite, PublicSitePort } from "./port.ts";
import { SitePreview } from "./SitePreview.tsx";

export function PublicSitePage({ port }: { port: PublicSitePort }) {
  const { slug = "" } = useParams();
  const [state, setState] = useState<{ slug: string; site: PublicSite | null; missing: boolean } | null>(null);
  useEffect(() => {
    let alive = true;
    port.site(slug).then((site) => alive && setState({ slug, site, missing: false }), () => alive && setState({ slug, site: null, missing: true }));
    return () => { alive = false; };
  }, [port, slug]);
  const current = state?.slug === slug ? state : null;
  return (
    <main className="tn-site-page">
      {port.kind === "demo" ? <StatusBanner tone="info"><strong>Demonstração.</strong> Site de exemplo; nada foi publicado de verdade.</StatusBanner> : null}
      {!current ? <p role="status">Carregando…</p> : null}
      {current?.missing ? (
        <PageHeader id="site-missing" title="Site não encontrado" subtitle="O endereço pode estar errado ou o negócio tirou o site do ar." />
      ) : null}
      {current?.site ? (
        <>
          <SitePreview site={current.site.site} headingLevel={1} live />
          <p className="tn-site-page__foot">Página feita com a Tinindo · versão {current.site.version_no}</p>
        </>
      ) : null}
    </main>
  );
}
