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

const rpc = async (accessToken: string | null, fn: string, args: Record<string, unknown>) => {
  const client = createClient(url, publicKey, {
    global: accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : {},
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.rpc(fn, args);
  return { data, error };
};

const handler = createNetworkHandler({
  allowedOrigins,
  publicAppUrl,
  photoBaseUrl: `${url.replace(/\/$/, "")}/storage/v1/object/public/profile-photos`,
  rpc,
  // Motor de agenda (P03), como anon: só horários livres de perfil publicado, sem tenant nem reservas.
  listPublicSlots: async (input) => {
    const { data, error } = await rpc(null, "scheduling_public_slots", {
      p_slug: input.slug,
      p_service_id: input.service_id,
      p_from: input.window.starts_at,
      p_to: input.window.ends_at,
    });
    if (error) throw new Error("public_slots_unavailable");
    return data as { slots: { starts_at: string; ends_at: string }[]; timezone: string };
  },
  log: (entry) => console.log(JSON.stringify(entry)),
});

Deno.serve(handler);
