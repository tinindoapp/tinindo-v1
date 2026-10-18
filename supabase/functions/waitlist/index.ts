// Entrada Deno da Edge Function `waitlist`. Chave PÚBLICA: com o JWT do dono nas rotas do negócio, como anon
// nas rotas do link. As RPCs do P06 (security definer + app.is_member / hash do token) decidem o acesso.
import { createClient } from "@supabase/supabase-js";
import { createWaitlistHandler } from "./handler.ts";

const url = Deno.env.get("SUPABASE_URL");
const publicKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY");
if (!url || !publicKey) throw new Error("SUPABASE_URL e chave pública são obrigatórias");

const allowedOrigins = (Deno.env.get("ALLOWED_ORIGINS") ?? "http://localhost:5173,http://127.0.0.1:5173")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

const handler = createWaitlistHandler({
  allowedOrigins,
  rpc: async (accessToken, fn, args) => {
    const client = createClient(url, publicKey, {
      global: accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : {},
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await client.rpc(fn, args);
    return { data: data ?? null, error };
  },
  log: (entry) => console.log(JSON.stringify(entry)),
});

Deno.serve(handler);
