// Rotas que o cliente final abre por link (/orcamento e /orcamento/:slug). Arquivo sem a tela do dono, sem sessão e sem
// o cliente Supabase: entra no pacote público. O `:slug` é o endereço do perfil do negócio (cabeçalho e saídas).
import { useMemo } from "react";
import type { RouteObject } from "react-router";
import { createDemoLinkPort } from "./demoPort.ts";
import type { QuoteLinkPort } from "./port.ts";
import { anonCall } from "../../components/public/public-kit.tsx";
import { QuoteLinkPage } from "./QuoteLinkPage.tsx";
import { createServerLinkPort } from "./serverPort.ts";
import "./sales.css";

function PublicQuote() {
  const port = useMemo<QuoteLinkPort>(() => {
    // Link anônimo: sem token de sessão; o token do orçamento vai no corpo do POST.
    const call = anonCall();
    return call ? createServerLinkPort(call) : createDemoLinkPort();
  }, []);
  return <QuoteLinkPage port={port} />;
}

/** Rotas públicas, fora do shell autenticado (montadas em src/app/router.tsx). */
export const salesPublicRoutes: RouteObject[] = [
  { path: "/orcamento", element: <PublicQuote /> },
  { path: "/orcamento/:slug", element: <PublicQuote /> },
];
