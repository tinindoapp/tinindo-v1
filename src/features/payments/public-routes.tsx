// Rotas que o cliente final abre por link (/pagar e /pagar/:slug). Arquivo sem a tela do dono, sem sessão e sem o
// cliente Supabase: entra no pacote público. O `:slug` é o endereço do perfil do negócio (cabeçalho e saídas).
import { useMemo } from "react";
import type { RouteObject } from "react-router";
import { createDemoLinkPort } from "./demoPort.ts";
import { PayLinkPage } from "./PayLinkPage.tsx";
import type { PaymentLinkPort } from "./port.ts";
import { anonCall } from "../../components/public/public-kit.tsx";
import { createServerLinkPort } from "./serverPort.ts";
import "./payments.css";

function PublicPay() {
  const port = useMemo<PaymentLinkPort>(() => {
    // Link anônimo: sem token de sessão; o token da cobrança vai no corpo do POST.
    const call = anonCall();
    return call ? createServerLinkPort(call) : createDemoLinkPort();
  }, []);
  return <PayLinkPage port={port} />;
}

/** Rotas públicas, fora do shell autenticado (montadas em src/app/router.tsx). */
export const paymentsPublicRoutes: RouteObject[] = [
  { path: "/pagar", element: <PublicPay /> },
  { path: "/pagar/:slug", element: <PublicPay /> },
];
