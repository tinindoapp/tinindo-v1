// Configuração da camada de linguagem SÓ por segredos do Supabase (`npx supabase secrets set …`), nunca no bundle.
// Trocar de provedor = mudar LLM_PROVIDER, LLM_MODEL e a chave, e reiniciar as funções. Ver release/LLM.md.
import { type LlmTask, PROVIDERS, type ProviderName, TASKS } from "./types.ts";

/** Modelo padrão só para a Anthropic (sugestão do plano). OpenAI e Gemini exigem LLM_MODEL: nada fixado no código. */
export const DEFAULT_MODELS: Partial<Record<ProviderName, string>> = { anthropic: "claude-haiku-5-5" };
export const DEFAULT_TIMEOUT_MS = 8000;
const MIN_TIMEOUT_MS = 500;
const MAX_TIMEOUT_MS = 30_000;

export const KEY_SECRET: Record<Exclude<ProviderName, "none">, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  gemini: "GEMINI_API_KEY",
};

export interface ProviderConfig {
  provider: Exclude<ProviderName, "none">;
  apiKey: string;
  /** Modelo por tarefa (LLM_MODEL_<TAREFA> ou LLM_MODEL ou o padrão do provedor). */
  models: Record<LlmTask, string>;
}

export interface LlmConfig {
  /** null = desligado (none, ausente, desconhecido ou incompleto). */
  primary: ProviderConfig | null;
  fallback: ProviderConfig | null;
  timeoutMs: number;
  /** Motivos técnicos de a configuração não valer (sem valores de segredo). Vão para o log na partida. */
  problems: string[];
}

export type EnvGetter = (name: string) => string | undefined;

function providerName(raw: string | undefined, problems: string[], secret: string): ProviderName {
  const v = (raw ?? "").trim().toLowerCase();
  if (v === "") return "none";
  if ((PROVIDERS as readonly string[]).includes(v)) return v as ProviderName;
  problems.push(`${secret} desconhecido; usando none`);
  return "none";
}

function providerConfig(name: ProviderName, env: EnvGetter, problems: string[]): ProviderConfig | null {
  if (name === "none") return null;
  const apiKey = (env(KEY_SECRET[name]) ?? "").trim();
  if (!apiKey) {
    problems.push(`${KEY_SECRET[name]} ausente; ${name} desligado`);
    return null;
  }
  const base = (env("LLM_MODEL") ?? "").trim() || DEFAULT_MODELS[name] || "";
  const models = {} as Record<LlmTask, string>;
  for (const task of TASKS) {
    const m = (env(`LLM_MODEL_${task.toUpperCase()}`) ?? "").trim() || base;
    if (!m) {
      problems.push(`LLM_MODEL ausente para ${name}; ${name} desligado`);
      return null;
    }
    models[task] = m;
  }
  return { provider: name, apiKey, models };
}

export function readLlmConfig(env: EnvGetter): LlmConfig {
  const problems: string[] = [];
  const primaryName = providerName(env("LLM_PROVIDER"), problems, "LLM_PROVIDER");
  const fallbackName = providerName(env("LLM_FALLBACK_PROVIDER"), problems, "LLM_FALLBACK_PROVIDER");
  const primary = providerConfig(primaryName, env, problems);
  // O modelo de LLM_MODEL é do provedor principal: a reserva usa só o padrão dela ou LLM_FALLBACK_MODEL.
  const fallbackEnv: EnvGetter = (k) => (k === "LLM_MODEL" ? env("LLM_FALLBACK_MODEL") : k.startsWith("LLM_MODEL_") ? undefined : env(k));
  const fallback = primary && fallbackName !== primaryName ? providerConfig(fallbackName, fallbackEnv, problems) : null;
  const rawTimeout = Number((env("LLM_TIMEOUT_MS") ?? "").trim() || DEFAULT_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(rawTimeout) ? Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, Math.round(rawTimeout))) : DEFAULT_TIMEOUT_MS;
  return { primary, fallback, timeoutMs, problems };
}
