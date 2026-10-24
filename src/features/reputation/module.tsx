// Módulo Avaliações · P24 (tasks/P24.md). Só esta pasta pertence ao módulo; src/app/modules.ts é do integrador.
import { useMemo } from "react";
import type { RouteObject } from "react-router";
import type { ModuleDefinition } from "../../app/module-types.ts";
import { appEnv } from "../../app/env.ts";
import { useSession } from "../../app/session.tsx";
import { PageHeader, StatusBanner } from "../../components/ui/index.tsx";
import { createApiClient } from "../../lib/api/client.ts";
import { createDemoCustomerPort, createDemoOwnerPort, createDemoPublicPort } from "./demoPort.ts";
import type { CustomerReviewsPort, OwnerReviewsPort, PublicReviewsPort } from "./port.ts";
import { CustomerReviewPage, OwnerReviewsPage, PublicReviewsPage } from "./ReviewPages.tsx";
import { createServerCustomerPort, createServerOwnerPort, createServerPublicPort } from "./serverPort.ts";
import "./reputation.css";

function OwnerLayout() {
  const { state, tenantId, getAccessToken } = useSession();
  const port = useMemo<OwnerReviewsPort | null>(() => {
    if (state.status === "offline_demo" || !appEnv.supabase) return createDemoOwnerPort();
    if (!tenantId) return null;
    return createServerOwnerPort(createApiClient({ baseUrl: appEnv.supabase.url, publishableKey: appEnv.supabase.publishableKey, getAccessToken }), tenantId);
  }, [state.status, tenantId, getAccessToken]);
  if (!port) {
    return (
      <div className="tn-page-intro">
        <PageHeader id="rev-no-tenant" title="Avaliações" />
        <StatusBanner tone="info">Selecione um negócio.</StatusBanner>
      </div>
    );
  }
  return <OwnerReviewsPage key={`${port.kind}:${tenantId ?? ""}`} port={port} />;
}

function CustomerReview() {
  const { state, getAccessToken } = useSession();
  const port = useMemo<CustomerReviewsPort>(() => {
    if (state.status === "offline_demo" || !appEnv.supabase) return createDemoCustomerPort();
    return createServerCustomerPort(createApiClient({ baseUrl: appEnv.supabase.url, publishableKey: appEnv.supabase.publishableKey, getAccessToken }));
  }, [state.status, getAccessToken]);
  return <CustomerReviewPage port={port} />;
}

function PublicReviews() {
  const port = useMemo<PublicReviewsPort>(() => {
    if (!appEnv.supabase) return createDemoPublicPort();
    return createServerPublicPort(createApiClient({ baseUrl: appEnv.supabase.url, publishableKey: appEnv.supabase.publishableKey, getAccessToken: async () => null }));
  }, []);
  return <PublicReviewsPage port={port} />;
}

/** Rotas fora do shell: o cliente avalia (com login, sem negócio) e a lista pública do perfil. */
export const reputationPublicRoutes: RouteObject[] = [
  { path: "/avaliar", element: <CustomerReview /> },
  { path: "/avaliacoes/:slug", element: <PublicReviews /> },
];

export const reputationModule: ModuleDefinition = {
  id: "reputation",
  owner: "P24",
  path: "avaliacoes",
  navLabel: "Avaliações",
  routes: [{ index: true, element: <OwnerLayout /> }],
};
