// Entrada Deno da Edge Function `push` (P34). Rotas do aparelho com a chave PÚBLICA + JWT da pessoa (as RPCs decidem
// o acesso). Só push.dispatch usa a chave de serviço, e só para push_claim e push_report, depois de conferir o segredo
// dos jobs. Chaves VAPID só pelos segredos VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY e VAPID_SUBJECT; sem elas, push desligado.
import { createClient } from "@supabase/supabase-js";
import { createPushHandler } from "./handler.ts";
import { vapidFromEnv } from "./webpush.ts";
import { withBuild } from "../_shared/http/build.ts";

const url = Deno.env.get("SUPABASE_URL");
const publicKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY");
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
if (!url || !publicKey) throw new Error("SUPABASE_URL e chave pública são obrigatórias");

const allowedOrigins = (Deno.env.get("ALLOWED_ORIGINS") ?? "http://localhost:5173,http://127.0.0.1:5173")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

const handler = createPushHandler({
  allowedOrigins,
  vapid: vapidFromEnv(Deno.env),
  jobsSecret: Deno.env.get("JOBS_SECRET") ?? null,
  rpc: async (accessToken, fn, args) => {
    const client = createClient(url, publicKey, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await client.rpc(fn, args);
    return { data: data ?? null, error };
  },
  serviceRpc: async (fn, args) => {
    if (!serviceKey) return { data: null, error: { message: "sem chave de serviço" } };
    const client = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await client.rpc(fn, args);
    return { data: data ?? null, error };
  },
  log: (entry) => console.log(JSON.stringify(entry)),
});

Deno.serve(withBuild(handler));
