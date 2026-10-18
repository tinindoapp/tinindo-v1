// Entrada Deno da Edge Function `jobs`. Segredos só no backend: SUPABASE_SERVICE_ROLE_KEY e JOBS_SECRET
// vêm do ambiente da função (nunca do frontend). Agendar com Supabase Cron a cada minuto (ver ADR-0011).
import { createClient } from "@supabase/supabase-js";
import { createJobsHandler } from "./handler.ts";

const url = Deno.env.get("SUPABASE_URL");
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const secret = Deno.env.get("JOBS_SECRET");
if (!url || !serviceKey || !secret) throw new Error("SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY e JOBS_SECRET são obrigatórios");

const client = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

Deno.serve(createJobsHandler({
  secret,
  runJobs: async (batch) => {
    const { data, error } = await client.rpc("jobs_run", { p_batch: batch });
    return { data, error };
  },
  log: (entry) => console.log(JSON.stringify(entry)),
}));
