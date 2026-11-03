// Ponto de entrada da camada de linguagem (P46). O resto do sistema importa daqui `llmFromEnv` (na partida da função)
// e o tipo `Llm`; nunca um adaptador. Os SDKs são carregados sob demanda: só o do provedor ligado entra na memória.
import { noneLlm } from "./adapters/none.ts";
import { createLlm, type LlmDeps, type Route } from "./client.ts";
import { type EnvGetter, type ProviderConfig, readLlmConfig } from "./config.ts";
import type { Adapter, Llm } from "./types.ts";

export type { ExtractRequest, Llm, LlmLogEntry, LlmTask } from "./types.ts";
export { noneLlm } from "./adapters/none.ts";
export { createLlm } from "./client.ts";
export { readLlmConfig } from "./config.ts";

async function adapterFor(cfg: ProviderConfig, timeoutMs: number): Promise<Adapter> {
  const opts = { apiKey: cfg.apiKey, timeoutMs };
  switch (cfg.provider) {
    case "anthropic":
      return (await import("./adapters/anthropic.ts")).createAnthropicAdapter(opts);
    case "openai":
      return (await import("./adapters/openai.ts")).createOpenAIAdapter(opts);
    case "gemini":
      return (await import("./adapters/gemini.ts")).createGeminiAdapter(opts);
  }
}

/**
 * Lê os segredos e monta o `Llm`. Sem LLM_PROVIDER (ou `none`), configuração incompleta ou SDK que não carrega:
 * `noneLlm`, e tudo continua determinístico. Os problemas vão para o log sem valor de segredo.
 */
export async function llmFromEnv(env: EnvGetter, deps: LlmDeps & { warn?: (msg: string) => void } = {}): Promise<Llm> {
  const cfg = readLlmConfig(env);
  for (const p of cfg.problems) deps.warn?.(p);
  if (!cfg.primary) return noneLlm;
  try {
    const primary: Route = { adapter: await adapterFor(cfg.primary, cfg.timeoutMs), models: cfg.primary.models };
    const fallback: Route | null = cfg.fallback
      ? { adapter: await adapterFor(cfg.fallback, cfg.timeoutMs), models: cfg.fallback.models }
      : null;
    return createLlm(primary, fallback, deps);
  } catch {
    deps.warn?.(`SDK de ${cfg.primary.provider} não carregou; usando none`);
    return noneLlm;
  }
}
