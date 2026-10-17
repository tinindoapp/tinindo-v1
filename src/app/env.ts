// Configuração pública do frontend. Todo VITE_* vai para o bundle: nunca colocar segredo aqui.
import { z } from "zod";

export const AppEnvName = z.enum(["local", "staging", "production"]);
export type AppEnvName = z.infer<typeof AppEnvName>;

const RawEnv = z.object({
  VITE_APP_ENV: AppEnvName.default("local"),
  VITE_SUPABASE_URL: z.url().optional().or(z.literal("").transform(() => undefined)),
  VITE_SUPABASE_PUBLISHABLE_KEY: z.string().optional().or(z.literal("").transform(() => undefined)),
});

export interface AppEnv {
  name: AppEnvName;
  /** Banner permanente de demonstração em tudo que não for produção. */
  demo: boolean;
  supabase: { url: string; publishableKey: string } | null;
}

export function parseEnv(raw: Record<string, unknown>): AppEnv {
  const env = RawEnv.parse(raw);
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY;
  // Bloqueio de segurança: chave secreta/service role nunca pode chegar ao navegador.
  if (key && /^(sb_secret_|service_role)/.test(key)) {
    throw new Error("VITE_SUPABASE_PUBLISHABLE_KEY recebeu uma chave secreta. Use a chave pública.");
  }
  if (env.VITE_APP_ENV === "production" && !(env.VITE_SUPABASE_URL && key)) {
    throw new Error("Produção exige VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY.");
  }
  return {
    name: env.VITE_APP_ENV,
    demo: env.VITE_APP_ENV !== "production",
    supabase: env.VITE_SUPABASE_URL && key ? { url: env.VITE_SUPABASE_URL, publishableKey: key } : null,
  };
}

export const appEnv: AppEnv = parseEnv(import.meta.env);
