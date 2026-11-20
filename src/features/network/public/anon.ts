// Acesso anônimo do módulo Perfil nas páginas públicas: sem sessão e sem o cliente Supabase (só fetch).
import { useState } from "react";
import { createDemoNetworkApi, createHttpNetworkApi, type NetworkApi } from "../api.ts";
import { anonCall, type BusinessReader, businessOf } from "../../../components/public/public-kit.tsx";

let shared: NetworkApi | null = null;
/** Uma instância por aba: as leituras públicas do perfil não dependem de quem está logado. */
export function publicNetworkApi(): NetworkApi {
  if (shared) return shared;
  const call = anonCall();
  shared = call ? createHttpNetworkApi(call, null) : createDemoNetworkApi(window.location.origin);
  return shared;
}
export const usePublicNetworkApi = () => useState(publicNetworkApi)[0];

/** Neste módulo o cabeçalho do negócio lê o perfil pela API do próprio módulo (vale também na demonstração). */
export const networkBusinessReader: BusinessReader = (slug) => publicNetworkApi().getPublicProfile(slug).then(businessOf, () => null);
