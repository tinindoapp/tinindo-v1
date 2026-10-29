import { useMemo } from "react";
import type { Profession } from "@contracts";
import { appEnv } from "../../app/env.ts";
import { useSession } from "../../app/session.tsx";
import { ApiError, createApiClient } from "../../lib/api/client.ts";
import { supabase } from "../../lib/supabase.ts";
import { createDemoNetworkApi, createHttpNetworkApi, type NetworkApi, type PhotoStorage } from "./api.ts";

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
    return createHttpNetworkApi(call, tenantId, photoStorage());
  }, [tenantId, getAccessToken]);
}

export const CATEGORY_LABEL: Record<Profession, string> = {
  barber: "Barbearia",
  hairdresser: "Cabeleireiro(a)",
  personal_trainer: "Personal trainer",
  other: "Outro serviço",
};

export const newIdempotencyKey = () => crypto.randomUUID();

/** Mensagem para a pessoa, sem detalhes técnicos; campos conhecidos ganham texto específico. */
export function errorMessage(e: unknown): string {
  if (!(e instanceof ApiError)) return "Falha inesperada. Tente novamente.";
  if (e.field === "slug") return "Este endereço já está em uso. Escolha outro.";
  if (e.field === "contact") return "Confirme seu e-mail antes de aceitar o convite.";
  if (e.code === "POLICY_REJECTED") return "Este convite já foi usado, venceu ou não pode ser aceito por esta conta.";
  if (e.code === "NOT_FOUND") return "Link inválido ou removido.";
  return e.message;
}

export const formatDateTime = (iso: string) =>
  new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(iso));

export const formatTime = (iso: string) =>
  new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }).format(new Date(iso));
