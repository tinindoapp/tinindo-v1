// Adaptador Gemini: SDK oficial `@google/genai` (no Deno, `npm:` pelo deno.json), saída estruturada por
// `responseMimeType: application/json` + `responseJsonSchema`. Sem temperature, topP nem topK. Modelo do LLM_MODEL.
import { ApiError, FinishReason, GoogleGenAI } from "@google/genai";
import { type Adapter, AdapterError, type AdapterRequest, type AdapterResponse } from "../types.ts";

export interface GeminiAdapterOptions {
  apiKey: string;
  timeoutMs: number;
  /** Só para teste (servidor falso). */
  baseURL?: string;
}

/** Fins que significam "o provedor se recusou" (bloqueio de conteúdo), não falha técnica. */
const REFUSAL_FINISH = new Set<string>([
  FinishReason.SAFETY, FinishReason.RECITATION, FinishReason.BLOCKLIST, FinishReason.PROHIBITED_CONTENT, FinishReason.SPII,
]);

export function createGeminiAdapter(opts: GeminiAdapterOptions): Adapter {
  const ai = new GoogleGenAI({
    apiKey: opts.apiKey,
    // Uma tentativa só: a falha cai na resposta determinística.
    httpOptions: { ...(opts.baseURL ? { baseUrl: opts.baseURL } : {}), retryOptions: { attempts: 1 } },
  });
  return {
    provider: "gemini",
    async call(req: AdapterRequest): Promise<AdapterResponse> {
      const abort = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        abort.abort();
      }, opts.timeoutMs);
      try {
        const res = await ai.models.generateContent({
          model: req.model,
          contents: req.input,
          config: {
            systemInstruction: req.system,
            responseMimeType: "application/json",
            responseJsonSchema: req.jsonSchema,
            maxOutputTokens: req.maxOutputTokens + 2048,
            abortSignal: abort.signal,
          },
        });
        const usage = {
          input_tokens: res.usageMetadata?.promptTokenCount ?? 0,
          output_tokens: (res.usageMetadata?.candidatesTokenCount ?? 0) + (res.usageMetadata?.thoughtsTokenCount ?? 0),
        };
        const cand = res.candidates?.[0];
        if (res.promptFeedback?.blockReason || (cand?.finishReason && REFUSAL_FINISH.has(cand.finishReason))) {
          return { text: null, refusal: true, truncated: false, usage };
        }
        const text = (cand?.content?.parts ?? []).filter((p) => !p.thought && typeof p.text === "string").map((p) => p.text).join("");
        return { text: text || null, refusal: false, truncated: cand?.finishReason === FinishReason.MAX_TOKENS, usage };
      } catch (e) {
        if (timedOut) throw new AdapterError("timeout");
        if (e instanceof ApiError) throw new AdapterError(e.status === 429 ? "rate_limited" : "error", e.status);
        throw new AdapterError("error");
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
