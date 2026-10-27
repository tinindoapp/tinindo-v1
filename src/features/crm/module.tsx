// Módulo Clientes e catálogo · dono: P02 (tasks/P02.md).
// Só esta pasta pertence ao módulo; src/app/modules.ts é do integrador.
import { useMemo } from "react";
import { Profession } from "@contracts";
import type { ModuleDefinition } from "../../app/module-types.ts";
import { appEnv } from "../../app/env.ts";
import { useSession } from "../../app/session.tsx";
import { Card, StatusBanner } from "../../components/ui/index.tsx";
import { createApiClient } from "../../lib/api/client.ts";
import { supabase } from "../../lib/supabase.ts";
import { type CrmApi, CrmApiContext, createDemoCrmApi, createServerCrmApi } from "./api.ts";
import { CustomersPage } from "./CustomersPage.tsx";
import { ImportPage } from "./ImportPage.tsx";
import { ServicesPage } from "./ServicesPage.tsx";
import { CrmOutlet } from "./shared.tsx";

function CrmLayout() {
  const session = useSession();
  const { getAccessToken, tenantId } = session;
  const offline = session.state.status === "offline_demo";
  const api = useMemo<CrmApi | null>(() => {
    if (offline) return createDemoCrmApi();
    if (!tenantId || !appEnv.supabase) return null;
    return createServerCrmApi({
      tenantId,
      call: createApiClient({
        baseUrl: appEnv.supabase.url,
        publishableKey: appEnv.supabase.publishableKey,
        getAccessToken,
      }),
      // Leitura simples pela Data API: a RLS de tenants só devolve negócio de que a pessoa é membro.
      readProfession: async () => {
        const { data } = (await supabase?.from("tenants").select("profession").eq("id", tenantId).maybeSingle()) ?? {};
        const parsed = Profession.safeParse((data as { profession?: unknown } | null)?.profession);
        return parsed.success ? parsed.data : "other";
      },
    });
  }, [offline, tenantId, getAccessToken]);

  if (!api) {
    return (
      <Card aria-labelledby="crm-no-tenant">
        <h1 id="crm-no-tenant">Clientes</h1>
        <StatusBanner tone="info">Selecione um negócio para ver clientes e serviços.</StatusBanner>
      </Card>
    );
  }
  return (
    <CrmApiContext.Provider value={api}>
      <CrmOutlet />
    </CrmApiContext.Provider>
  );
}

export const crmModule: ModuleDefinition = {
  id: "crm",
  owner: "P02",
  path: "clientes",
  navLabel: "Clientes",
  routes: [
    {
      element: <CrmLayout />,
      children: [
        { index: true, element: <CustomersPage /> },
        { path: "servicos", element: <ServicesPage /> },
        { path: "importar", element: <ImportPage /> },
      ],
    },
  ],
};
