// Entrada Deno da Edge Function `context`. Usa a chave PÚBLICA + JWT do usuário:
// a RLS e resolve_context decidem o acesso. Nenhuma chave secreta aqui.
import { createClient } from "@supabase/supabase-js";
import { createContextHandler } from "./handler.ts";

const url = Deno.env.get("SUPABASE_URL");
const publicKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY");
if (!url || !publicKey) throw new Error("SUPABASE_URL e chave pública são obrigatórias");

const allowedOrigins = (Deno.env.get("ALLOWED_ORIGINS") ?? "http://localhost:5173,http://127.0.0.1:5173")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

const handler = createContextHandler({
  allowedOrigins,
  resolveContext: async (accessToken, tenantId) => {
    const client = createClient(url, publicKey, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await client.rpc("resolve_context", { p_tenant_id: tenantId });
    return { data: (data as unknown[] | null) ?? null, error };
  },
  log: (entry) => console.log(JSON.stringify(entry)),
});

Deno.serve(handler);
