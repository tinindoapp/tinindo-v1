// `llm.extract`: redige a entrada (sem PII), chama o provedor ligado com saída estruturada, valida de novo pelo zod e
// registra a chamada sem conteúdo. Qualquer falha (JSON inválido, recusa, 429, tempo esgotado, erro) devolve null e o
// chamador segue pelo caminho determinístico. Com reserva configurada, tenta a reserva uma vez antes de devolver null.
import { estimateCostUsd, PRICE_TABLE_VERSION } from "./prices.ts";
import { redactPii } from "./redact.ts";
import { providerSchema } from "./schema.ts";
import {
  type Adapter,
  AdapterError,
  type CallResult,
  type ExtractRequest,
  type Llm,
  type LlmLogEntry,
  type LlmTask,
} from "./types.ts";

/** Entrada máxima enviada (caracteres, depois da redação). Pedido do assistente tem até 2000. */
export const MAX_INPUT_CHARS = 4000;
const DEFAULT_MAX_OUTPUT = 1024;

export interface Route {
  adapter: Adapter;
  models: Record<LlmTask, string>;
}

export interface LlmDeps {
  log?: (entry: LlmLogEntry) => void;
  now?: () => number;
}

export function createLlm(primary: Route | null, fallback: Route | null, deps: LlmDeps = {}): Llm {
  const now = deps.now ?? (() => Date.now());
  if (!primary) return { enabled: false, extract: () => Promise.resolve(null) };

  async function attempt<T>(route: Route, req: ExtractRequest<T>, input: string, isFallback: boolean): Promise<T | null> {
    const model = route.models[req.task];
    const started = now();
    let result: CallResult;
    let usage = { input_tokens: 0, output_tokens: 0 };
    let value: T | null = null;
    try {
      const res = await route.adapter.call({
        model,
        system: req.system,
        input,
        schemaName: `tinindo_${req.task}`,
        jsonSchema: providerSchema(req.schema),
        maxOutputTokens: req.maxOutputTokens ?? DEFAULT_MAX_OUTPUT,
      });
      usage = res.usage;
      if (res.refusal) {
        result = "refusal";
      } else if (res.truncated || res.text === null) {
        result = "invalid";
      } else {
        let json: unknown;
        try {
          json = JSON.parse(res.text);
        } catch {
          json = undefined;
        }
        const parsed = json === undefined ? null : req.schema.safeParse(json);
        if (parsed?.success) {
          value = parsed.data;
          result = "ok";
        } else {
          result = "invalid";
        }
      }
    } catch (e) {
      result = e instanceof AdapterError ? e.kind : "error";
    }
    deps.log?.({
      fn: "llm",
      task: req.task,
      provider: route.adapter.provider,
      model,
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      cost_usd: estimateCostUsd(model, usage.input_tokens, usage.output_tokens),
      price_table: PRICE_TABLE_VERSION,
      ms: Math.max(0, now() - started),
      result,
      fallback: isFallback,
    });
    return value;
  }

  return {
    enabled: true,
    async extract<T>(req: ExtractRequest<T>): Promise<T | null> {
      // Redação dentro do extract: nenhum chamador manda telefone, e-mail ou documento, nem por engano.
      const input = redactPii(req.input).slice(0, MAX_INPUT_CHARS);
      const first = await attempt(primary, req, input, false);
      if (first !== null || !fallback) return first;
      return attempt(fallback, req, input, true);
    },
  };
}
