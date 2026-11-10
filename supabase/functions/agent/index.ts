// Entrada Deno da Edge Function `agent`. Chave PÚBLICA + JWT do usuário: as RPCs do P08 (security definer +
// app.is_member) decidem acesso, franquia e execução.
// P46: a camada de linguagem é lida dos segredos (LLM_PROVIDER etc., ver release/LLM.md). Sem LLM_PROVIDER = none,
// e o assistente é o motor determinístico do P08. O registro de cada chamada ao modelo não tem conteúdo.
import { createClient } from "@supabase/supabase-js";
import { llmFromEnv } from "../_shared/llm/index.ts";
import { createAgentHandler } from "./handler.ts";

const url = Deno.env.get("SUPABASE_URL");
const publicKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY");
if (!url || !publicKey) throw new Error("SUPABASE_URL e chave pública são obrigatórias");

const allowedOrigins = (Deno.env.get("ALLOWED_ORIGINS") ?? "http://localhost:5173,http://127.0.0.1:5173")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

const log = (entry: unknown) => console.log(JSON.stringify(entry));
const llm = await llmFromEnv((name) => Deno.env.get(name), {
  log,
  warn: (msg) => console.warn(JSON.stringify({ fn: "llm", config: msg })),
});

const handler = createAgentHandler({
  allowedOrigins,
  llm,
  rpc: async (accessToken, fn, args) => {
    const client = createClient(url, publicKey, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await client.rpc(fn, args);
    return { data: data ?? null, error };
  },
  log,
});

Deno.serve(handler);
