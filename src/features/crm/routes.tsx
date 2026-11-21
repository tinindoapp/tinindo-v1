// Telas do módulo, carregadas sob demanda pelo manifesto (module.tsx). Mesmo comportamento de antes do P53 (recado #148):
// o layout escolhe a fonte de dados (demonstração ou servidor com o cliente da sessão) e as telas ficam no Outlet.
import { useMemo } from "react";
import { Profession } from "@contracts";
import { useApi } from "../../app/api.tsx";
import { PageHeader, StatusBanner } from "../../components/ui/index.tsx";
import { supabase } from "../../lib/supabase.ts";
import { type CrmApi, CrmApiContext, createDemoCrmApi, createServerCrmApi } from "./api.ts";
import { CrmOutlet } from "./shared.tsx";

export { CustomerPage } from "./CustomerPage.tsx";
export { CustomersPage } from "./CustomersPage.tsx";
export { ImportPage } from "./ImportPage.tsx";
export { ServicesPage } from "./ServicesPage.tsx";

export function CrmLayout() {
  const { demo, call, tenantId } = useApi();
  const api = useMemo<CrmApi | null>(() => {
    if (demo) return createDemoCrmApi();
    if (!tenantId || !call) return null;
    return createServerCrmApi({
      tenantId,
      call,
      // Leitura simples pela Data API: a RLS de tenants só devolve negócio de que a pessoa é membro.
      readProfession: async () => {
        const { data } = (await supabase?.from("tenants").select("profession").eq("id", tenantId).maybeSingle()) ?? {};
        const parsed = Profession.safeParse((data as { profession?: unknown } | null)?.profession);
        return parsed.success ? parsed.data : "other";
      },
    });
  }, [demo, call, tenantId]);

  if (!api) {
    return (
      <div className="tn-stack">
        <PageHeader id="crm-no-tenant" title="Clientes" />
        <StatusBanner tone="info">Selecione um negócio para ver clientes e serviços.</StatusBanner>
      </div>
    );
  }
  return (
    <CrmApiContext.Provider value={api}>
      <CrmOutlet />
    </CrmApiContext.Provider>
  );
}
