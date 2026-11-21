// Captura de erro do frontend (P58): erro de tela, chamada que voltou 5xx ou não chegou, e erro solto na página.
// Cada linha leva só tipo, rota da tela SEM id, função chamada, status, código do catálogo, SHA do build e request_id.
// Nunca a mensagem do erro, o corpo, o token, o negócio ou dado de cliente. Grava em public.ops_errors pela RPC
// public.ops_error_record (sem serviço externo). Na demonstração, sem Supabase, nada sai.
// A ligação na raiz do app (src/app) é do integrador: README.md desta pasta.
import { now } from "../time.ts";

export type FrontErrorKind = "render" | "call" | "unhandled";

export interface FrontError {
  kind: FrontErrorKind;
  fn: string | null;
  route: string | null;
  status: number | null;
  code: string | null;
  build_sha: string | null;
  request_id: string | null;
}

export type Sender = (row: FrontError) => Promise<void>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CODE = /^[A-Za-z][A-Za-z0-9_]{0,59}$/;
const FN = /^[a-z][a-z0-9-]{0,40}$/;
const SHA = /^[0-9a-f]{7,40}$/;

/** Mesma regra do banco (app.ops_clean_route): sem query, e trecho com id, número longo, @ ou comprido vira ":id". */
export function cleanRoute(path: string | null | undefined): string | null {
  const base = ((path ?? "").slice(0, 400).toLowerCase().split("?")[0] ?? "").split("#")[0] ?? "";
  const out = base
    .split("/")
    .map((s) => (UUID.test(s) || /[0-9]{3,}/.test(s) || s.includes("@") || s.length > 40 ? ":id" : s.replace(/[^a-z0-9:._-]/g, "")))
    .join("/")
    .slice(0, 160);
  return out || null;
}

/** Só o nome do tipo de erro (TypeError, ChunkLoadError…); a mensagem pode ter dado e nunca sai. */
export function errorName(e: unknown): string {
  const name = e instanceof Error ? e.name : typeof e === "object" && e && "name" in e ? String((e as { name: unknown }).name) : "";
  return CODE.test(name) ? name : "Error";
}

/** Função chamada, a partir do endereço da Edge Function (…/functions/v1/<função>/<rota>). */
export function functionOf(url: string): string | null {
  const m = /\/functions\/v1\/([^/?#]+)/.exec(url);
  const fn = m?.[1];
  return fn && FN.test(fn) ? fn : null;
}

export interface TelemetryOptions {
  send: Sender;
  /** SHA do build (version.json); valor fora do formato não sai. */
  sha?: string | null;
  /** Rota da tela agora (padrão: location.pathname). */
  route?: () => string | null;
  /** Teto por carregamento de página (padrão 20) e janela de repetição (padrão 60 s). */
  maxPerPage?: number;
  repeatWindowMs?: number;
}

export interface Telemetry {
  capture(row: Omit<FrontError, "build_sha" | "route"> & { route?: string | null }): void;
  /** Erro de tela (errorElement do roteador, error boundary). */
  captureRender(error: unknown): void;
  /** fetch que registra resposta 5xx e falha de rede das chamadas às funções; o resultado não muda. */
  wrapFetch(f: typeof fetch): typeof fetch;
  /** Erro solto e promessa rejeitada sem tratamento. Devolve a função que desfaz. */
  install(target: Pick<Window, "addEventListener" | "removeEventListener">): () => void;
}

export function createTelemetry(opts: TelemetryOptions): Telemetry {
  const sha = opts.sha && SHA.test(opts.sha.toLowerCase()) ? opts.sha.toLowerCase() : null;
  const routeNow = opts.route ?? (() => (typeof location === "undefined" ? null : location.pathname));
  const max = opts.maxPerPage ?? 20;
  const windowMs = opts.repeatWindowMs ?? 60_000;
  const seen = new Map<string, number>();
  let sent = 0;

  const capture: Telemetry["capture"] = (row) => {
    const full: FrontError = {
      kind: row.kind,
      fn: row.fn && FN.test(row.fn) ? row.fn : null,
      route: cleanRoute(row.route ?? routeNow()),
      status: row.status,
      code: row.code && CODE.test(row.code) ? row.code : null,
      build_sha: sha,
      request_id: row.request_id && UUID.test(row.request_id.toLowerCase()) ? row.request_id.toLowerCase() : null,
    };
    const key = `${full.kind}|${full.fn}|${full.route}|${full.code}|${full.status}`;
    const t = now().getTime();
    if (sent >= max || (seen.get(key) ?? -Infinity) > t - windowMs) return;
    seen.set(key, t);
    sent += 1;
    // A captura nunca vira outro erro na tela.
    opts.send(full).catch(() => undefined);
  };

  return {
    capture,
    captureRender(error) {
      capture({ kind: "render", fn: null, status: null, code: errorName(error), request_id: null });
    },
    wrapFetch(f) {
      return async (input, init) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        const fn = functionOf(url);
        const requestId = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined)).get("X-Request-Id");
        let res: Response;
        try {
          res = await f(input, init);
        } catch (e) {
          if (fn) capture({ kind: "call", fn, status: 0, code: "NETWORK", request_id: requestId });
          throw e;
        }
        if (fn && res.status >= 500) {
          const body = (await res.clone().json().catch(() => null)) as { error?: { code?: unknown } } | null;
          const code = typeof body?.error?.code === "string" ? body.error.code : null;
          capture({ kind: "call", fn, status: res.status, code, request_id: res.headers.get("X-Request-Id") ?? requestId });
        }
        return res;
      };
    },
    install(target) {
      const onError = (ev: Event) => capture({ kind: "unhandled", fn: null, status: null, code: errorName((ev as ErrorEvent).error), request_id: null });
      const onRejection = (ev: Event) => capture({ kind: "unhandled", fn: null, status: null, code: errorName((ev as PromiseRejectionEvent).reason), request_id: null });
      target.addEventListener("error", onError);
      target.addEventListener("unhandledrejection", onRejection);
      return () => {
        target.removeEventListener("error", onError);
        target.removeEventListener("unhandledrejection", onRejection);
      };
    },
  };
}

/** Envio pela Data API (RPC), com a chave pública. `keepalive` deixa o envio terminar mesmo saindo da página. */
export function restSender(opts: { url: string; publishableKey: string; fetch?: typeof fetch }): Sender {
  const doFetch = opts.fetch ?? fetch;
  const endpoint = `${opts.url.replace(/\/$/, "")}/rest/v1/rpc/ops_error_record`;
  const headers: Record<string, string> = { "Content-Type": "application/json", apikey: opts.publishableKey };
  if (opts.publishableKey.startsWith("eyJ")) headers.Authorization = `Bearer ${opts.publishableKey}`;
  return async (row) => {
    await doFetch(endpoint, {
      method: "POST",
      headers,
      keepalive: true,
      body: JSON.stringify({
        p_source: "front", p_kind: row.kind, p_fn: row.fn, p_route: row.route, p_status: row.status,
        p_code: row.code, p_build_sha: row.build_sha, p_request_id: row.request_id,
      }),
    });
  };
}

/** Telemetria do app: com Supabase, grava; sem (demonstração), não faz nada e o fetch passa direto. */
export function createAppTelemetry(cfg: { supabase: { url: string; publishableKey: string } | null; sha: string | null }): Telemetry {
  if (!cfg.supabase) {
    return { capture: () => undefined, captureRender: () => undefined, wrapFetch: (f) => f, install: () => () => undefined };
  }
  return createTelemetry({ send: restSender(cfg.supabase), sha: cfg.sha });
}
