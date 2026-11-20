// Worker do frontend (Cloudflare). Serve os arquivos do build (binding ASSETS) e só roda código nas rotas
// configuradas em `run_worker_first` (wrangler.jsonc): o perfil (/p/*), o endereço antigo do site (/s/*, que
// redireciona) e as páginas do cliente final (/pagar, /orcamento, /avaliar, /reserva, /avaliacoes/*, /oferta), para a
// prévia do link (worker/og.ts). Falhar aberto: qualquer erro devolve o app como ele é, sem prévia personalizada.
import { injectTags, type OgConfig, routeOf, tagsFor } from "./og.ts";
import { withSecurityHeaders } from "./security-headers.ts";

interface Env {
  ASSETS: { fetch(input: Request | string): Promise<Response> };
}

const NO_CONFIG: OgConfig = { supabase_url: null, publishable_key: null };

/** Sem o arquivo de configuração (ou ilegível), segue sem Supabase: as páginas do cliente ficam com o texto neutro. */
async function config(env: Env, origin: string): Promise<OgConfig> {
  try {
    const res = await env.ASSETS.fetch(`${origin}/og-config.json`);
    return res.ok ? ((await res.json()) as OgConfig) : NO_CONFIG;
  } catch {
    return NO_CONFIG;
  }
}

/** Toda resposta do Worker sai com os cabeçalhos de segurança (P57), inclusive o redirecionamento e a queda segura. */
export async function handle(request: Request, env: Env, fetcher: typeof fetch = fetch): Promise<Response> {
  const res = await route(request, env, fetcher);
  return withSecurityHeaders(res, { supabase_url: null });
}

async function route(request: Request, env: Env, fetcher: typeof fetch): Promise<Response> {
  const url = new URL(request.url);
  const route = request.method === "GET" || request.method === "HEAD" ? routeOf(url.pathname) : null;
  // D19: /p absorveu o site. /s/:slug muda de vez para /p/:slug, com a mesma query, antes de tocar nos arquivos.
  if (route?.kind === "redirect") {
    return new Response(null, { status: 301, headers: { location: `${url.origin}/p/${route.slug}${url.search}` } });
  }
  const rewrite = route && request.method === "GET" ? route : null;
  // A rota do SPA devolve o index.html (not_found_handling); pedimos o próprio index para não depender disso.
  const page = await env.ASSETS.fetch(rewrite ? new Request(`${url.origin}/`, request) : request);
  if (!rewrite || !page.ok || !(page.headers.get("content-type") ?? "").includes("text/html")) return page;
  try {
    const html = await page.clone().text();
    const tags = await tagsFor(rewrite, url.origin, await config(env, url.origin), fetcher);
    if (!tags) return page;
    const headers = new Headers(page.headers);
    headers.delete("content-length");
    headers.delete("etag");
    // Tirar o perfil do ar vale em minutos (mesma regra da página indexável do site).
    headers.set("cache-control", "public, max-age=300");
    return new Response(injectTags(html, tags), { status: 200, headers });
  } catch {
    return page;
  }
}

export default { fetch: (request: Request, env: Env) => handle(request, env) };
