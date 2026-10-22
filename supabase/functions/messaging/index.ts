// Entrada Deno da Edge Function `messaging`. Rotas do dono: chave PÚBLICA + JWT do usuário. Rotas de sistema
// (webhook, despacho, simulador): chave de SERVIÇO, só aqui e só para as RPCs channel_* de backend (como `jobs`).
// MESSAGING_PROVIDER escolhe o provedor real; o simulado sempre existe e exige MESSAGING_SIM_SECRET.
import { createClient } from "@supabase/supabase-js";
import { createSimulatedProvider, createWhatsAppProvider } from "../_shared/domain/messaging/providers.ts";
import { createMessagingHandler } from "./handler.ts";

const url = Deno.env.get("SUPABASE_URL");
const publicKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY");
const serviceKey = Deno.env.get("SUPABASE_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const dispatchSecret = Deno.env.get("MESSAGING_DISPATCH_SECRET");
const simulatedSecret = Deno.env.get("MESSAGING_SIM_SECRET");
if (!url || !publicKey || !serviceKey) throw new Error("SUPABASE_URL, chave pública e chave de serviço são obrigatórias");
if (!dispatchSecret || !simulatedSecret) throw new Error("MESSAGING_DISPATCH_SECRET e MESSAGING_SIM_SECRET são obrigatórios");

const allowedOrigins = (Deno.env.get("ALLOWED_ORIGINS") ?? "http://localhost:5173,http://127.0.0.1:5173")
  .split(",").map((o) => o.trim()).filter(Boolean);

const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const serviceRpc = async (fn: string, args: Record<string, unknown>) => {
  const { data, error } = await service.rpc(fn, args);
  return { data: data ?? null, error };
};

const handler = createMessagingHandler({
  allowedOrigins,
  dispatchSecret,
  simulatedSecret,
  verifyToken: Deno.env.get("WHATSAPP_VERIFY_TOKEN") ?? null,
  providers: {
    simulated: createSimulatedProvider({
      secret: simulatedSecret,
      deliver: async (phone, from, body, id) => {
        await serviceRpc("channel_sim_deliver", { p_phone_e164: phone, p_from_account: from, p_body: body, p_provider_message_id: id });
      },
    }),
    whatsapp_cloud: createWhatsAppProvider({
      accessToken: Deno.env.get("WHATSAPP_ACCESS_TOKEN") ?? null,
      appSecret: Deno.env.get("WHATSAPP_APP_SECRET") ?? null,
    }),
  },
  serviceRpc,
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
