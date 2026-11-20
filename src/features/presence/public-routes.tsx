// Parte pública do módulo Site (P17), sem a tela do dono nem sessão.
// D19: há uma página pública só. `/s/:slug` leva a `/p/:slug`, que mostra o conteúdo do site publicado (frase,
// serviços com preço e horários) junto do perfil e da reserva. O Worker faz o mesmo com 301 para robôs.
import { useEffect, useState } from "react";
import { Navigate, type RouteObject, useLocation, useParams } from "react-router";
import { appEnv } from "../../app/env.ts";
import { createDemoPublicPort } from "./demoPort.ts";
import type { PublicSite } from "./port.ts";

/**
 * `/s/:slug` → `/p/:slug`, mantendo a busca e a âncora (ex.: #agendar).
 * Com servidor, a página /p lê o site publicado pela API. Na demonstração não há servidor e o site de exemplo vive na
 * memória deste módulo: ele segue junto no estado da navegação (`state.site`), que a página /p valida antes de usar.
 */
export function SiteRedirect() {
  const { slug = "" } = useParams();
  const { search, hash } = useLocation();
  const demo = !appEnv.supabase;
  const [site, setSite] = useState<PublicSite | null | undefined>(demo ? undefined : null);
  useEffect(() => {
    if (!demo) return;
    let alive = true;
    createDemoPublicPort().site(slug).then((s) => alive && setSite(s), () => alive && setSite(null));
    return () => {
      alive = false;
    };
  }, [demo, slug]);
  if (site === undefined) return null;
  return <Navigate to={{ pathname: `/p/${slug}`, search, hash }} state={site ? { site } : undefined} replace />;
}

export const presencePublicRoutes: RouteObject[] = [{ path: "/s/:slug", element: <SiteRedirect /> }];
