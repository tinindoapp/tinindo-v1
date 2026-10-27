// Worker do frontend (Cloudflare). Serve os arquivos do build (binding ASSETS) e só roda código nas rotas
// configuradas em `run_worker_first` (wrangler.jsonc): /p/* e /s/*, para a prévia do link (worker/og.ts).
// Falhar aberto: qualquer erro devolve o app como ele é, sem prévia personalizada.
import { injectTags, type OgConfig, routeOf, tagsFor } from "./og.ts";

interface Env {
  ASSETS: { fetch(input: Request | string): Promise<Response> };
}

async function config(env: Env, origin: string): Promise<OgConfig> {
  const res = await env.ASSETS.fetch(`${origin}/og-config.json`);
  if (!res.ok) return { supabase_url: null, publishable_key: null };
  return (await res.json()) as OgConfig;
}

export async function handle(request: Request, env: Env, fetcher: typeof fetch = fetch): Promise<Response> {
  const url = new URL(request.url);
  const route = request.method === "GET" ? routeOf(url.pathname) : null;
  // A rota do SPA devolve o index.html (not_found_handling); pedimos o próprio index para não depender disso.
  const page = await env.ASSETS.fetch(route ? new Request(`${url.origin}/`, request) : request);
  if (!route || !page.ok || !(page.headers.get("content-type") ?? "").includes("text/html")) return page;
  try {
    const html = await page.clone().text();
    const tags = await tagsFor(route, url.origin, await config(env, url.origin), fetcher);
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
