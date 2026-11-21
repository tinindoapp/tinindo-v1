// Entrada Deno da Edge Function `privacy` (P57). Chave PÚBLICA + JWT do usuário: as RPCs decidem dono, carência e
// trilha; o Storage grava e assina o arquivo pelas políticas do bucket `privacy-exports`. Nenhuma chave secreta aqui.
import { createClient } from "@supabase/supabase-js";
import { withBuild } from "../_shared/http/build.ts";
import { BUCKET, createPrivacyHandler } from "./handler.ts";

const url = Deno.env.get("SUPABASE_URL");
const publicKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY");
if (!url || !publicKey) throw new Error("SUPABASE_URL e chave pública são obrigatórias");

const allowedOrigins = (Deno.env.get("ALLOWED_ORIGINS") ?? "http://localhost:5173,http://127.0.0.1:5173")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

const clientFor = (accessToken: string) =>
  createClient(url, publicKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

const handler = createPrivacyHandler({
  allowedOrigins,
  rpc: async (accessToken, fn, args) => {
    const { data, error } = await clientFor(accessToken).rpc(fn, args);
    return { data: data ?? null, error };
  },
  storage: {
    async upload(accessToken, path, body) {
      const { error } = await clientFor(accessToken).storage.from(BUCKET)
        .upload(path, new Blob([new Uint8Array(body)], { type: "application/json" }), { contentType: "application/json", upsert: true });
      if (error) throw new Error("upload");
    },
    async signedUrl(accessToken, path, seconds) {
      const { data, error } = await clientFor(accessToken).storage.from(BUCKET).createSignedUrl(path, seconds, { download: true });
      if (error || !data?.signedUrl) throw new Error("sign");
      return data.signedUrl;
    },
  },
  log: (entry) => console.log(JSON.stringify(entry)),
});

Deno.serve(withBuild(handler));
