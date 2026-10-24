// Entrada Deno da Edge Function `presence`. Rotas do dono e da operação: chave PÚBLICA + JWT do usuário (o banco
// autoriza). Página pública: chave pública sem JWT (anon). Resultado da consulta DNS: chave de SERVIÇO, só aqui e só
// para `presence_domain_record_check`. A consulta usa o resolvedor do runtime (Deno.resolveDns).
import { createClient } from "@supabase/supabase-js";
import { createPresenceHandler } from "./handler.ts";

const url = Deno.env.get("SUPABASE_URL");
const publicKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY");
const serviceKey = Deno.env.get("SUPABASE_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
if (!url || !publicKey || !serviceKey) throw new Error("SUPABASE_URL, chave pública e chave de serviço são obrigatórias");

const allowedOrigins = (Deno.env.get("ALLOWED_ORIGINS") ?? "http://localhost:5173,http://127.0.0.1:5173")
  .split(",").map((o) => o.trim()).filter(Boolean);
const publicAppUrl = Deno.env.get("PUBLIC_APP_URL") ?? allowedOrigins[0] ?? "http://localhost:5173";

const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const anon = createClient(url, publicKey, { auth: { persistSession: false, autoRefreshToken: false } });

const handler = createPresenceHandler({
  allowedOrigins,
  publicAppUrl,
  cnameTarget: Deno.env.get("PRESENCE_CNAME_TARGET") ?? null,
  resolveTxt: async (name) => {
    try {
      return (await Deno.resolveDns(name, "TXT")).map((parts) => parts.join(""));
    } catch (e) {
      // Nome inexistente ou sem TXT é resposta (nada encontrado); outra falha sobe e vira "lookup_failed".
      if (e instanceof Deno.errors.NotFound) return [];
      throw e;
    }
  },
  serviceRpc: async (fn, args) => {
    const { data, error } = await service.rpc(fn, args);
    return { data: data ?? null, error };
  },
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
