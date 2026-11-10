// Adaptador OpenAI: SDK oficial `openai` (no Deno, `npm:` pelo deno.json), Responses API com saída estruturada
// `text.format` json_schema em modo estrito. Sem temperature nem top_p. O modelo vem do segredo LLM_MODEL.
import OpenAI from "openai";
import { type Adapter, AdapterError, type AdapterRequest, type AdapterResponse } from "../types.ts";

export interface OpenAIAdapterOptions {
  apiKey: string;
  timeoutMs: number;
  /** Só para teste (servidor falso). */
  baseURL?: string;
}

export function createOpenAIAdapter(opts: OpenAIAdapterOptions): Adapter {
  const client = new OpenAI({ apiKey: opts.apiKey, baseURL: opts.baseURL, timeout: opts.timeoutMs, maxRetries: 0 });
  return {
    provider: "openai",
    async call(req: AdapterRequest): Promise<AdapterResponse> {
      let res: OpenAI.Responses.Response;
      try {
        res = await client.responses.create({
          model: req.model,
          instructions: req.system,
          input: req.input,
          max_output_tokens: req.maxOutputTokens + 2048,
          // Sem guardar a conversa no provedor.
          store: false,
          text: { format: { type: "json_schema", name: req.schemaName, schema: req.jsonSchema, strict: true } },
        });
      } catch (e) {
        throw classify(e);
      }
      const usage = { input_tokens: res.usage?.input_tokens ?? 0, output_tokens: res.usage?.output_tokens ?? 0 };
      let refusal = false;
      let text = "";
      for (const item of res.output ?? []) {
        if (item.type !== "message") continue;
        for (const part of item.content) {
          if (part.type === "refusal") refusal = true;
          else if (part.type === "output_text") text += part.text;
        }
      }
      if (refusal) return { text: null, refusal: true, truncated: false, usage };
      const truncated = res.status === "incomplete";
      return { text: text || null, refusal: false, truncated, usage };
    },
  };
}

function classify(e: unknown): AdapterError {
  if (e instanceof OpenAI.APIConnectionTimeoutError) return new AdapterError("timeout");
  if (e instanceof OpenAI.RateLimitError) return new AdapterError("rate_limited", 429);
  if (e instanceof OpenAI.APIError) return new AdapterError("error", typeof e.status === "number" ? e.status : null);
  return new AdapterError("error");
}
