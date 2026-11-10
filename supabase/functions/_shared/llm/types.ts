// Camada de linguagem (P46). Uma interface só para o resto do sistema: `llm.extract({task, system, input, schema})`
// devolve um objeto validado pelo zod da tarefa, ou null. Ninguém fora de `_shared/llm/` sabe qual provedor está ligado.
//
// Regra calcula, modelo redige (docs/05, ADR-0012 §1): o modelo só lê texto e devolve uma forma fechada. Quem decide
// autorização, preço, horário e execução continua sendo o servidor, pelas mesmas ferramentas, propostas e aprovações.
import type { z } from "zod";

export const PROVIDERS = ["none", "anthropic", "openai", "gemini"] as const;
export type ProviderName = (typeof PROVIDERS)[number];

/** Tarefas com modelo próprio opcional (`LLM_MODEL_<TAREFA>`). */
export const TASKS = ["intent", "setup", "draft", "explain"] as const;
export type LlmTask = (typeof TASKS)[number];

export interface ExtractRequest<T> {
  task: LlmTask;
  /** Instrução fixa da tarefa (código, nunca texto do usuário). */
  system: string;
  /** Texto do usuário ou dados mínimos da tarefa. Passa pela redação de PII antes de sair. */
  input: string;
  schema: z.ZodType<T>;
  /** Teto de saída. Padrão 1024. */
  maxOutputTokens?: number;
}

export interface Llm {
  /** false com `LLM_PROVIDER=none` (ou configuração incompleta): extract sempre devolve null sem rede. */
  readonly enabled: boolean;
  extract<T>(req: ExtractRequest<T>): Promise<T | null>;
}

/** Resultado de uma chamada: o mesmo vocabulário no registro de todos os provedores. */
export type CallResult = "ok" | "invalid" | "refusal" | "rate_limited" | "timeout" | "error" | "disabled";

/** Uma linha por chamada. Sem texto de entrada, de saída nem do sistema; sem tenant, usuário ou chave. */
export interface LlmLogEntry {
  fn: "llm";
  task: LlmTask;
  provider: ProviderName;
  model: string | null;
  input_tokens: number;
  output_tokens: number;
  /** Estimativa em US$ pela tabela versionada; null quando o modelo não está na tabela. */
  cost_usd: number | null;
  price_table: string;
  ms: number;
  result: CallResult;
  /** Este registro é do provedor de reserva (`LLM_FALLBACK_PROVIDER`). */
  fallback: boolean;
}

/** O que cada adaptador recebe: já sem PII, com o schema na forma aceita pelo provedor. */
export interface AdapterRequest {
  model: string;
  system: string;
  input: string;
  schemaName: string;
  jsonSchema: Record<string, unknown>;
  maxOutputTokens: number;
}

export interface AdapterResponse {
  /** Texto JSON devolvido pelo provedor (null = nenhum texto). */
  text: string | null;
  /** O provedor recusou (stop_reason refusal, bloco de recusa, bloqueio de segurança). */
  refusal: boolean;
  /** Resposta cortada (limite de tokens) ou incompleta: conta como inválida. */
  truncated: boolean;
  usage: { input_tokens: number; output_tokens: number };
}

export interface Adapter {
  readonly provider: Exclude<ProviderName, "none">;
  call(req: AdapterRequest): Promise<AdapterResponse>;
}

/** Falha classificada do adaptador. Os SDKs têm classes próprias; aqui viram três casos. */
export class AdapterError extends Error {
  constructor(readonly kind: "rate_limited" | "timeout" | "error", readonly status: number | null = null) {
    super(kind);
    this.name = "AdapterError";
  }
}
