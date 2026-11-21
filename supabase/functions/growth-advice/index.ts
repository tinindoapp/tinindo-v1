// Entrada Deno da Edge Function `growth-advice`. Usa a chave PÚBLICA + JWT do usuário:
// as RPCs do P22 (dono) (security definer + app.is_member) decidem o acesso. O acompanhamento das sugestões é do worker `jobs`; a publicação passa pelo escopo do perfil (P09). Nenhuma chave secreta aqui.
// "Por quê?" nos insights (`insight.explain`): a camada de linguagem do P46 é lida dos segredos (LLM_PROVIDER etc., ver
// release/LLM.md). Sem LLM_PROVIDER = none, e a explicação é a frase fixa por regra. O registro de cada chamada ao
// modelo não tem conteúdo.
import { createClient } from "@supabase/supabase-js";
import { llmFromEnv } from "../_shared/llm/index.ts";
import { createGrowthAdviceHandler } from "./handler.ts";
import { withBuild } from "../_shared/http/build.ts";

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

const handler = createGrowthAdviceHandler({
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

Deno.serve(withBuild(handler));
