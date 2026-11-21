// Regras do service worker (P34, app instalável) em funções puras, para testar sem navegador. O `sw.ts` só liga estas
// regras aos eventos do navegador.
//
// O que o service worker faz, e o que nunca faz:
// - Navegação (abrir uma tela): rede primeiro. Sem rede, o app guardado (index.html), para a casca abrir.
// - Arquivos do build com hash (/assets/*): do cache, que nunca muda para o mesmo nome.
// - Chamadas às Edge Functions: as leituras da Hoje e da Agenda guardam a última resposta para abrir sem internet
//   (sw-offline.ts); comando vai só pela rede e, sem ela, falha na hora. Nada é guardado nem posto em fila para depois.
// - Páginas do cliente final (/p, /pagar, /reserva…): passam direto; o cliente não precisa do app guardado.
import { isPublicPath } from "../public-paths.ts";

export type RequestKind = "navigation" | "asset" | "precached" | "api" | "passthrough";

export interface RequestInfo {
  url: string;
  method: string;
  mode: string;
  /** Origem do app (self.location.origin). */
  origin: string;
}

/** Nome dos caches desta versão. A versão vem do build (commit e hora). */
export const cacheNames = (version: string) => ({
  shell: `tinindo-shell-${version}`,
});

/** Prefixo comum: só os caches do app (os de outra origem ou de outro código não são tocados). */
export const SHELL_PREFIX = "tinindo-shell-";

export function classify(r: RequestInfo, precache: ReadonlySet<string>): RequestKind {
  let u: URL;
  try {
    u = new URL(r.url);
  } catch {
    return "passthrough";
  }
  // Edge Functions: em qualquer origem (o Supabase é outro domínio).
  if (u.pathname.includes("/functions/v1/")) return r.method === "GET" || r.method === "POST" ? "api" : "passthrough";
  if (r.method !== "GET" || u.origin !== r.origin) return "passthrough";
  if (r.mode === "navigate") return isPublicPath(u.pathname) ? "passthrough" : "navigation";
  if (u.pathname.startsWith("/assets/")) return "asset";
  // version.json, og-config.json e sw.js: sempre da rede (dizem qual versão está no ar).
  if (precache.has(u.pathname)) return "precached";
  return "passthrough";
}

/**
 * Caches que saem ao ativar uma versão: todos os do app, menos o desta versão e o da anterior. A anterior fica para a
 * aba que ainda roda o código antigo conseguir baixar um pedaço que ainda não tinha aberto.
 */
export function cachesToDelete(existing: readonly string[], current: string): string[] {
  // A versão começa pela hora do build (swVersion), então a ordem do nome é a ordem das versões.
  const older = existing.filter((n) => n.startsWith(SHELL_PREFIX) && n < current).sort();
  const previous = older.at(-1) ?? null;
  return existing.filter((n) => n.startsWith(SHELL_PREFIX) && n !== current && n !== previous);
}

/** Versão do service worker: hora do build (ordenável) e o commit. Muda a cada build, então todo deploy instala. */
export function swVersion(builtAt: string, commit: string): string {
  const stamp = builtAt.replace(/[-:]/g, "").replace(/\.\d+/, "");
  return `${stamp}-${commit.slice(0, 7)}`;
}

/** Arquivos do build que entram no cache de instalação: tudo menos mapas de código e arquivos de configuração. */
export function precacheList(bundleFiles: readonly string[], publicFiles: readonly string[]): string[] {
  // Fontes de outros alfabetos (cirílico, grego, vietnamita) só baixam se a tela precisar; o português usa latin e latin-ext.
  const skip = /(\.map$|^_headers$|^version\.json$|^og-config\.json$|^sw\.js$|^og\/|inter-(cyrillic|greek|vietnamese))/;
  const files = [...bundleFiles, ...publicFiles].filter((f) => !skip.test(f)).map((f) => `/${f.replace(/^\//, "")}`);
  return [...new Set(["/", "/index.html", ...files])].sort();
}

/** Mensagens entre a página e o service worker. */
export const SW_MESSAGE = { skipWaiting: "tinindo:skip-waiting", clearOffline: "tinindo:clear-offline" } as const;
