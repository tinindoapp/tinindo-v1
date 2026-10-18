// Entrada Deno da Edge Function `network` (P09). Usa a chave PÚBLICA: com o JWT do usuário
// quando há login, como anon nas rotas públicas. RLS e as RPCs decidem o acesso.
import { createClient } from "@supabase/supabase-js";
import { createNetworkHandler } from "./handler.ts";

const url = Deno.env.get("SUPABASE_URL");
const publicKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY");
const publicAppUrl = Deno.env.get("PUBLIC_APP_URL");
if (!url || !publicKey) throw new Error("SUPABASE_URL e chave pública são obrigatórias");
if (!publicAppUrl) throw new Error("PUBLIC_APP_URL é obrigatória para montar links compartilháveis");

const allowedOrigins = (Deno.env.get("ALLOWED_ORIGINS") ?? "http://localhost:5173,http://127.0.0.1:5173")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

const handler = createNetworkHandler({
  allowedOrigins,
  publicAppUrl,
  rpc: async (accessToken, fn, args) => {
    const client = createClient(url, publicKey, {
      global: accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : {},
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await client.rpc(fn, args);
    return { data, error };
  },
  // listPublicSlots: conectar ao motor de agenda (P03) quando availability.list existir no banco.
  log: (entry) => console.log(JSON.stringify(entry)),
});

Deno.serve(handler);
