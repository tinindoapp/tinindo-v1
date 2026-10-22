// Entrada Deno da Edge Function `payments`. Rotas do dono: chave PÚBLICA + JWT do usuário. Rotas públicas do link:
// chave pública sem JWT (anon). Rotas de sistema (webhook, sync, resultado do provedor, PSP simulado): chave de
// SERVIÇO, só aqui e só para as RPCs payment_* de backend (como `jobs`). Credenciais do PSP só no ambiente.
import { createClient } from "@supabase/supabase-js";
import { createPspProvider, createSimulatedPaymentProvider } from "../_shared/domain/payments/providers.ts";
import { createPaymentsHandler } from "./handler.ts";

const url = Deno.env.get("SUPABASE_URL");
const publicKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY");
const serviceKey = Deno.env.get("SUPABASE_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const syncSecret = Deno.env.get("PAYMENTS_SYNC_SECRET");
const simulatedSecret = Deno.env.get("PAYMENTS_SIM_SECRET");
if (!url || !publicKey || !serviceKey) throw new Error("SUPABASE_URL, chave pública e chave de serviço são obrigatórias");
if (!syncSecret || !simulatedSecret) throw new Error("PAYMENTS_SYNC_SECRET e PAYMENTS_SIM_SECRET são obrigatórios");

const allowedOrigins = (Deno.env.get("ALLOWED_ORIGINS") ?? "http://localhost:5173,http://127.0.0.1:5173")
  .split(",").map((o) => o.trim()).filter(Boolean);
const publicAppUrl = Deno.env.get("PUBLIC_APP_URL") ?? allowedOrigins[0] ?? "http://localhost:5173";

const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const serviceRpc = async (fn: string, args: Record<string, unknown>) => {
  const { data, error } = await service.rpc(fn, args);
  return { data: data ?? null, error };
};
const anon = createClient(url, publicKey, { auth: { persistSession: false, autoRefreshToken: false } });

const handler = createPaymentsHandler({
  allowedOrigins,
  syncSecret,
  simulatedSecret,
  publicAppUrl,
  providers: {
    simulated: createSimulatedPaymentProvider({ secret: simulatedSecret, store: serviceRpc }),
    psp: createPspProvider({
      baseUrl: Deno.env.get("PSP_BASE_URL") ?? null,
      apiKey: Deno.env.get("PSP_API_KEY") ?? null,
      webhookSecret: Deno.env.get("PSP_WEBHOOK_SECRET") ?? null,
    }),
  },
  serviceRpc,
  anonRpc: async (fn, args) => {
    const { data, error } = await anon.rpc(fn, args);
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
