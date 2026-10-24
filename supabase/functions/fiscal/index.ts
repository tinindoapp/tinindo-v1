// Entrada Deno da Edge Function `fiscal`. Rotas do dono: chave PÚBLICA + JWT do usuário (o banco autoriza e decide a
// elegibilidade). Resultado do provedor e consulta dos incertos: chave de SERVIÇO, só aqui e só para as RPCs fiscal_*
// de backend. Homologação usa o provedor simulado; produção só com FISCAL_PROVIDER_URL/FISCAL_PROVIDER_KEY (e a
// liberação do negócio pelo backend). Nenhum certificado ou senha do prestador passa por aqui.
import { createClient } from "@supabase/supabase-js";
import { createRestFiscalProvider, createSimulatedFiscalProvider } from "../_shared/domain/fiscal/providers.ts";
import { createFiscalHandler } from "./handler.ts";

const url = Deno.env.get("SUPABASE_URL");
const publicKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY");
const serviceKey = Deno.env.get("SUPABASE_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const syncSecret = Deno.env.get("FISCAL_SYNC_SECRET");
if (!url || !publicKey || !serviceKey) throw new Error("SUPABASE_URL, chave pública e chave de serviço são obrigatórias");
if (!syncSecret) throw new Error("FISCAL_SYNC_SECRET é obrigatório");

const allowedOrigins = (Deno.env.get("ALLOWED_ORIGINS") ?? "http://localhost:5173,http://127.0.0.1:5173")
  .split(",").map((o) => o.trim()).filter(Boolean);
const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const rest = createRestFiscalProvider({ baseUrl: Deno.env.get("FISCAL_PROVIDER_URL") ?? null, apiKey: Deno.env.get("FISCAL_PROVIDER_KEY") ?? null });

const handler = createFiscalHandler({
  allowedOrigins,
  syncSecret,
  // Homologação: o provedor real quando configurado (homologação dele); senão o simulado, sempre rotulado.
  providers: { homologacao: rest.configured ? rest : createSimulatedFiscalProvider(), producao: rest },
  serviceRpc: async (fn, args) => {
    const { data, error } = await service.rpc(fn, args);
    return { data: data ?? null, error };
  },
  rpc: async (accessToken, fn, args) => {
    const client = createClient(url, publicKey, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await client.rpc(fn, args);
    return { data: data ?? null, error };
  },
  log: (entry) => console.log(JSON.stringify(entry)),
});

Deno.serve(handler);
