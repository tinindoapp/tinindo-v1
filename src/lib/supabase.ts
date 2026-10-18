// Cliente Supabase do navegador: só URL + chave pública. RLS decide o que cada login vê.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { appEnv } from "../app/env.ts";

export const supabase: SupabaseClient | null = appEnv.supabase
  ? createClient(appEnv.supabase.url, appEnv.supabase.publishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;
