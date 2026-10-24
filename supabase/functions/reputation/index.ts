// Entrada Deno da Edge Function `reputation`. Dono e cliente: chave PÚBLICA + JWT do usuário (o banco autoriza: dono
// por membership, cliente pelo vínculo verificado do P01). Lista pública: chave pública sem JWT (anon). Moderação e
// verificação de identidade são do backend (service_role) e não têm rota aqui. Nenhuma chave secreta aqui.
import { createClient } from "@supabase/supabase-js";
import { createReputationHandler } from "./handler.ts";

const url = Deno.env.get("SUPABASE_URL");
const publicKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY");
if (!url || !publicKey) throw new Error("SUPABASE_URL e chave pública são obrigatórias");

const allowedOrigins = (Deno.env.get("ALLOWED_ORIGINS") ?? "http://localhost:5173,http://127.0.0.1:5173")
  .split(",").map((o) => o.trim()).filter(Boolean);
const anon = createClient(url, publicKey, { auth: { persistSession: false, autoRefreshToken: false } });

const handler = createReputationHandler({
  allowedOrigins,
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
