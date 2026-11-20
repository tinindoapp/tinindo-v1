import { useMemo } from "react";
import { Profession } from "@contracts";
import { appEnv } from "../../app/env.ts";
import { useSession } from "../../app/session.tsx";
import { ApiError, createApiClient } from "../../lib/api/client.ts";
import { supabase } from "../../lib/supabase.ts";
import { type BusinessBasics, createDemoNetworkApi, createHttpNetworkApi, type NetworkApi, type PhotoStorage } from "./api.ts";

/** Bucket profile-photos pelo cliente do navegador, com a sessão de quem está logado. */
function photoStorage(): PhotoStorage | null {
  if (!supabase) return null;
  const bucket = supabase.storage.from("profile-photos");
  return {
    async upload(path, blob, contentType) {
      // Caminho novo a cada foto (uuid): nada é sobrescrito, e a URL pública pode ficar em cache por um ano.
      const { error } = await bucket.upload(path, blob, { contentType, upsert: false, cacheControl: "31536000" });
      if (error) throw new ApiError("PROVIDER_UNAVAILABLE", "Não foi possível enviar a foto. Tente de novo.", 503, null, true);
    },
    async remove(path) {
      await bucket.remove([path]);
    },
    publicUrl: (path) => bucket.getPublicUrl(path).data.publicUrl,
  };
}

/** Nome e profissão do negócio (tenants, RLS: só membros leem). */
async function readBusiness(tenantId: string): Promise<BusinessBasics | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.from("tenants").select("name, profession").eq("id", tenantId).maybeSingle();
  if (error || !data) return null;
  const profession = Profession.safeParse(data.profession);
  return profession.success ? { name: String(data.name), profession: profession.data } : null;
}

/** Servidor real quando o Supabase está configurado; senão, demonstração offline rotulada. */
export function useNetworkApi(): NetworkApi {
  const { tenantId, getAccessToken } = useSession();
  return useMemo(() => {
    if (!appEnv.supabase) return createDemoNetworkApi(window.location.origin);
    const call = createApiClient({
      baseUrl: appEnv.supabase.url,
      publishableKey: appEnv.supabase.publishableKey,
      getAccessToken,
    });
    return createHttpNetworkApi(call, tenantId, photoStorage(), readBusiness);
  }, [tenantId, getAccessToken]);
}

// Rótulos e mensagens ficam em public/labels.ts (sem sessão), para o pacote das páginas públicas não carregar o Supabase.
export { CATEGORY_LABEL, errorMessage, formatDateTime, formatPhoneBr, newIdempotencyKey } from "./public/labels.ts";
