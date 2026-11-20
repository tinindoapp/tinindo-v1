// Um cliente de API por sessão (P53, R4 do doc 15). Antes cada tela criava o seu (`createApiClient` em 42 lugares) e cada
// porta pedia `/context` de novo (15 lugares). Este embrulha o cliente comum e guarda a leitura de `/context` por
// negócio: a primeira chamada vai ao servidor, as seguintes reaproveitam a mesma promessa. Falha não fica guardada (a
// próxima tenta de novo). A sessão chama `forget()` ao trocar de login; trocar de negócio usa outra entrada do cache.
// Quem autoriza continua sendo o servidor em cada chamada: o cache só evita repetir a leitura do contexto.
import { type ApiClientOptions, type CallOptions, createApiClient } from "./client.ts";
import type { z } from "zod";

export type ApiCall = ReturnType<typeof createApiClient>;
export type SessionApiCall = ApiCall & { forget(): void };

const CONTEXT_PATH = "/context";

export function createSessionClient(opts: ApiClientOptions): SessionApiCall {
  const call = createApiClient(opts);
  const contexts = new Map<string, Promise<unknown>>();

  const shared = (<T extends z.ZodType>(path: string, schema: T, options: CallOptions = {}) => {
    const method = options.method ?? "GET";
    if (path !== CONTEXT_PATH || method !== "GET" || !options.tenantId || options.body !== undefined) {
      return call(path, schema, options);
    }
    const key = options.tenantId;
    let hit = contexts.get(key);
    if (!hit) {
      hit = call(path, schema, options);
      contexts.set(key, hit);
      hit.catch(() => {
        if (contexts.get(key) === hit) contexts.delete(key);
      });
    }
    // Cada leitor valida com o próprio schema (todos usam ContextResponse, mas não é preciso confiar nisso).
    return hit.then((r) => {
      const { data, meta } = r as { data: unknown; meta: unknown };
      const parsed = schema.safeParse(data);
      if (!parsed.success) return call(path, schema, options);
      return { data: parsed.data, meta } as Awaited<ReturnType<ApiCall>>;
    });
  }) as SessionApiCall;
  shared.forget = () => contexts.clear();
  return shared;
}
