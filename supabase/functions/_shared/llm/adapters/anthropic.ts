// Adaptador Anthropic: SDK oficial `@anthropic-ai/sdk` (no Deno, `npm:` pelo deno.json), saída estruturada por
// `output_config.format` (json_schema) e esforço `low`. Sem temperature, top_p nem top_k: a API recusa esses campos
// e o controle é pelo esforço e pelo schema.
import Anthropic from "@anthropic-ai/sdk";
import { type Adapter, AdapterError, type AdapterRequest, type AdapterResponse } from "../types.ts";

export interface AnthropicAdapterOptions {
  apiKey: string;
  timeoutMs: number;
  /** Só para teste (servidor falso). Em produção, o endereço padrão do SDK. */
  baseURL?: string;
}

export function createAnthropicAdapter(opts: AnthropicAdapterOptions): Adapter {
  // Sem novas tentativas: o teto de tempo é por chamada e a falha cai na resposta determinística.
  const client = new Anthropic({ apiKey: opts.apiKey, baseURL: opts.baseURL, timeout: opts.timeoutMs, maxRetries: 0 });
  return {
    provider: "anthropic",
    async call(req: AdapterRequest): Promise<AdapterResponse> {
      let msg: Anthropic.Message;
      try {
        msg = await client.messages.create({
          model: req.model,
          // O raciocínio (adaptativo, ligado por padrão) conta dentro de max_tokens: folga acima da saída útil.
          max_tokens: req.maxOutputTokens + 2048,
          system: req.system,
          messages: [{ role: "user", content: req.input }],
          output_config: { effort: "low", format: { type: "json_schema", schema: req.jsonSchema } },
        });
      } catch (e) {
        throw classify(e);
      }
      const usage = { input_tokens: msg.usage?.input_tokens ?? 0, output_tokens: msg.usage?.output_tokens ?? 0 };
      if (msg.stop_reason === "refusal") return { text: null, refusal: true, truncated: false, usage };
      const truncated = msg.stop_reason === "max_tokens" || msg.stop_reason === "model_context_window_exceeded";
      const text = msg.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
      return { text: text || null, refusal: false, truncated, usage };
    },
  };
}

function classify(e: unknown): AdapterError {
  if (e instanceof Anthropic.APIConnectionTimeoutError) return new AdapterError("timeout");
  if (e instanceof Anthropic.RateLimitError) return new AdapterError("rate_limited", 429);
  if (e instanceof Anthropic.APIError) return new AdapterError("error", typeof e.status === "number" ? e.status : null);
  return new AdapterError("error");
}
