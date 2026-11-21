// Captura de erro das funções (P58): toda resposta 5xx e toda exceção sem resposta viram uma linha em public.ops_errors,
// com função, rota, status, código do catálogo, SHA e request_id. Nada do corpo do pedido, do token ou do negócio.
// Sem serviço externo: grava pela RPC public.ops_error_record com a chave pública (a mesma que a função já usa).
// TypeScript puro (Web APIs): roda em Deno e Node 22.
import { REQUEST_ID_HEADER } from "../contracts/index.ts";
import { isUuid } from "./respond.ts";

export interface CapturedError {
  kind: "http_5xx" | "exception";
  fn: string | null;
  route: string | null;
  status: number;
  code: string | null;
  build_sha: string | null;
  request_id: string | null;
}

export type Recorder = (row: CapturedError) => Promise<void>;

const FN_RE = /^[a-z][a-z0-9-]{0,40}$/;
const ROUTE_RE = /^[a-z0-9_.]{1,80}$/;
const CODE_RE = /^[A-Za-z][A-Za-z0-9_]{0,59}$/;

/** Função e rota a partir do caminho: /functions/v1/<função>/<rota> (ou /<função>/<rota>, como o Supabase entrega). */
export function fnAndRoute(url: string): { fn: string | null; route: string | null } {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return { fn: null, route: null };
  }
  const parts = path.replace(/^\/functions\/v1(?=\/)/, "").split("/").filter(Boolean);
  const fn = parts[0] && FN_RE.test(parts[0]) ? parts[0] : null;
  const rest = parts.slice(1).join("/");
  return { fn, route: rest && ROUTE_RE.test(rest) ? rest : null };
}

/** Código do catálogo no envelope de erro v1 ({error: {code}}), sem ler mais nada do corpo. */
async function errorCode(res: Response): Promise<string | null> {
  if (!(res.headers.get("Content-Type") ?? "").includes("json")) return null;
  try {
    const body = (await res.clone().json()) as { error?: { code?: unknown } } | null;
    const code = body?.error?.code;
    return typeof code === "string" && CODE_RE.test(code) ? code : null;
  } catch {
    return null;
  }
}

export async function captureResponse(req: Request, res: Response, sha: string | null): Promise<CapturedError | null> {
  if (res.status < 500) return null;
  const rid = res.headers.get(REQUEST_ID_HEADER);
  return {
    kind: "http_5xx",
    ...fnAndRoute(req.url),
    status: res.status,
    code: await errorCode(res),
    build_sha: sha,
    request_id: isUuid(rid) ? rid.toLowerCase() : null,
  };
}

export function captureException(req: Request, sha: string | null, requestId: string): CapturedError {
  return { kind: "exception", ...fnAndRoute(req.url), status: 500, code: "INTERNAL_ERROR", build_sha: sha, request_id: requestId };
}

/** Grava pela RPC; nunca lança (a captura não pode virar outro erro) e desiste depois de `timeoutMs`. */
export function rpcRecorder(opts: { url: string; key: string; fetch?: typeof fetch; timeoutMs?: number }): Recorder {
  const doFetch = opts.fetch ?? fetch;
  const endpoint = `${opts.url.replace(/\/$/, "")}/rest/v1/rpc/ops_error_record`;
  const headers: Record<string, string> = { "Content-Type": "application/json", apikey: opts.key };
  // Chave antiga (JWT anon) vai também no Authorization; a publicável nova vai só no apikey.
  if (opts.key.startsWith("eyJ")) headers.Authorization = `Bearer ${opts.key}`;
  return async (row) => {
    try {
      await doFetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({
          p_source: "function", p_kind: row.kind, p_fn: row.fn, p_route: row.route, p_status: row.status,
          p_code: row.code, p_build_sha: row.build_sha, p_request_id: row.request_id,
        }),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 2000),
      });
    } catch {
      // sem rede ou banco fora: o log da função continua com o erro
    }
  };
}

type DenoEnv = { Deno?: { env: { get(k: string): string | undefined } } };

/** Gravador do ambiente da função. OPS_CAPTURE=off desliga; sem URL ou chave pública, não grava. */
export function envRecorder(): Recorder | null {
  try {
    const env = (globalThis as DenoEnv).Deno?.env;
    if (!env || env.get("OPS_CAPTURE") === "off") return null;
    const url = env.get("SUPABASE_URL");
    const key = env.get("SUPABASE_PUBLISHABLE_KEY") ?? env.get("SUPABASE_ANON_KEY");
    return url && key ? rpcRecorder({ url, key }) : null;
  } catch {
    return null;
  }
}

/** Deixa a gravação terminar depois da resposta quando o runtime permite (EdgeRuntime.waitUntil); senão, espera. */
export async function inBackground(task: Promise<void>): Promise<void> {
  const rt = (globalThis as { EdgeRuntime?: { waitUntil?(p: Promise<unknown>): void } }).EdgeRuntime;
  if (typeof rt?.waitUntil === "function") {
    rt.waitUntil(task);
    return;
  }
  await task;
}
