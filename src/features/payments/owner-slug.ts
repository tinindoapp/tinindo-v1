// Tela do dono que monta um link para o cliente: o endereço do perfil publicado entra no caminho do link
// (`withBusinessSlug` do public-kit), para a prévia no WhatsApp dizer o nome do negócio. Sem perfil publicado → null e o
// link fica como era. Cópia idêntica em payments e sales (módulo não importa módulo): lê `network/profile.get` pela API.
import { OwnerProfileOutput } from "@contracts";
import { useEffect, useState } from "react";
import { appEnv } from "../../app/env.ts";
import { useSession } from "../../app/session.tsx";
import { createApiClient } from "../../lib/api/client.ts";
import { getPublishedSlug } from "../../lib/demo/journey.ts";

export function usePublishedSlug(): string | null {
  const { state, tenantId, getAccessToken } = useSession();
  const demo = state.status === "offline_demo" || !appEnv.supabase;
  const [slug, setSlug] = useState<string | null>(() => (demo ? getPublishedSlug() : null));
  useEffect(() => {
    if (demo || !tenantId || !appEnv.supabase) return;
    let alive = true;
    const call = createApiClient({ baseUrl: appEnv.supabase.url, publishableKey: appEnv.supabase.publishableKey, getAccessToken });
    call("/network/profile.get", OwnerProfileOutput, { tenantId }).then(
      (r) => alive && setSlug(r.data.profile?.published_at ? r.data.profile.slug : null),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [demo, tenantId, getAccessToken]);
  return slug;
}
