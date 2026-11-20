import { useMemo } from "react";
import { Profession } from "@contracts";
import { useApi } from "../../app/api.tsx";
import { appEnv } from "../../app/env.ts";
import { ApiError } from "../../lib/api/client.ts";
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
  // O cliente da sessão (P53). Sem Supabase configurado, demonstração; com Supabase, mesmo antes do login (as páginas
  // públicas de convite e indicação chamam sem sessão), como era.
  const { call, tenantId } = useApi();
  return useMemo(() => {
    if (!appEnv.supabase || !call) return createDemoNetworkApi(window.location.origin);
    return createHttpNetworkApi(call, tenantId, photoStorage(), readBusiness);
  }, [call, tenantId]);
}

// Rótulos e mensagens ficam em public/labels.ts (sem sessão), para o pacote das páginas públicas não carregar o Supabase.
export { CATEGORY_LABEL, errorMessage, formatDateTime, formatPhoneBr, newIdempotencyKey } from "./public/labels.ts";
