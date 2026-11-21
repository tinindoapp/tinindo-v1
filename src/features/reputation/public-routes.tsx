// Rota que qualquer pessoa abre sem login (/avaliacoes/:slug). Arquivo sem o painel do dono, sem sessão e sem o cliente
// Supabase: entra no pacote público. /avaliar (com login) continua em module.tsx.
import { useMemo } from "react";
import type { RouteObject } from "react-router";
import { createDemoPublicPort } from "./demoPort.ts";
import type { PublicReviewsPort } from "./port.ts";
import { anonCall } from "../../components/public/public-kit.tsx";
import { PublicReviewsPage } from "./PublicReviewsPage.tsx";
import { createServerPublicPort } from "./serverPort.ts";
import "./reputation.css";

function publicPort(): PublicReviewsPort {
  const call = anonCall();
  return call ? createServerPublicPort(call) : createDemoPublicPort();
}

/** Lista pública para quem monta as rotas (as avaliações em destaque do perfil). Falhou ou não existe: null. */
export const readPublicReviews = (slug: string) => publicPort().list(slug).catch(() => null);

function PublicReviews() {
  const port = useMemo<PublicReviewsPort>(() => publicPort(), []);
  return <PublicReviewsPage port={port} />;
}

/** Lista pública do perfil, fora do shell autenticado. */
export const reputationAnonRoutes: RouteObject[] = [{ path: "/avaliacoes/:slug", element: <PublicReviews /> }];
