// Edge Function `discovery` (P23): opt-in do dono pelo rpc-handler; busca e índice de cidades públicos (anon); página
// HTML indexável por cidade e profissão (GET /discovery/page?uf=&city=&category=).
import {
  DirectoryCitiesInput, DirectoryCitiesOutput, DirectorySearchInput, DirectorySearchOutput, DiscoveryGetInput, DiscoveryOverview, DiscoverySaveInput,
} from "../_shared/contracts/index.ts";
import { renderDirectoryPage } from "../_shared/domain/discovery/render.ts";
import { mapDbError } from "../_shared/http/errors.ts";
import { corsHeaders, fail, ok, requestIdFrom, systemClock } from "../_shared/http/respond.ts";
import { createRpcHandler, type Route, route, type RpcHandlerDeps, type RpcResult } from "../_shared/http/rpc-handler.ts";

export interface DiscoveryDeps extends RpcHandlerDeps {
  anonRpc(fn: string, args: Record<string, unknown>): Promise<RpcResult>;
  publicAppUrl: string;
}

export const DISCOVERY_ROUTES: Record<string, Route> = {
  "discovery.get": route({ rpc: "discovery_get", input: DiscoveryGetInput, output: DiscoveryOverview, command: false, args: () => ({}) }),
  "discovery.save": route({
    rpc: "discovery_save", input: DiscoverySaveInput, output: DiscoveryOverview, command: true,
    args: (i) => ({ p_expected_version: i.expected_version, p_uf: i.uf, p_city_name: i.city_name, p_show_hours: i.show_hours, p_listed: i.listed }),
  }),
};
export const DISCOVERY_PUBLIC = {
  "directory.search": { rpc: "discovery_search", input: DirectorySearchInput, output: DirectorySearchOutput },
  "directory.cities": { rpc: "discovery_cities", input: DirectoryCitiesInput, output: DirectoryCitiesOutput },
} as const;
const ROUTE_RE = /\/discovery\/([a-z_.]+)\/?$/;

export function createDiscoveryHandler(deps: DiscoveryDeps) {
  const clock = deps.clock ?? systemClock;
  const owner = createRpcHandler("discovery", DISCOVERY_ROUTES, deps);

  return async (req: Request): Promise<Response> => {
    const name = ROUTE_RE.exec(new URL(req.url).pathname)?.[1] ?? "";
    const started = clock.now().getTime();
    const requestId = requestIdFrom(req);
    const cors = corsHeaders(req, deps.allowedOrigins);
    let res: Response;
    if (name === "directory.search" || name === "directory.cities") res = await publicRoute(name, req, requestId, cors);
    else if (name === "page") res = await page(req, requestId);
    else return owner(req);
    deps.log?.({ fn: "discovery", route: name, request_id: requestId, status: res.status, ms: clock.now().getTime() - started });
    return res;
  };

  async function search(input: unknown) {
    const parsed = DirectorySearchInput.safeParse(input);
    if (!parsed.success) return { error: { code: "VALIDATION_ERROR" as const, field: parsed.error.issues[0]?.path.map(String).join(".") } };
    const i = parsed.data;
    const r = await deps.anonRpc("discovery_search", { p_uf: i.uf, p_city_slug: i.city_slug, p_category: i.category, p_area: i.area, p_weekday: i.weekday, p_page: i.page }).catch(() => null);
    if (!r) return { error: { code: "PROVIDER_UNAVAILABLE" as const } };
    if (r.error) return { error: mapDbError(r.error) };
    const out = DirectorySearchOutput.safeParse(r.data);
    return out.success ? { data: out.data, input: i } : { error: { code: "INTERNAL_ERROR" as const } };
  }

  async function publicRoute(name: "directory.search" | "directory.cities", req: Request, requestId: string, cors: Record<string, string>): Promise<Response> {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (req.method !== "POST") return fail("VALIDATION_ERROR", requestId, { message: "Use POST.", extra: cors });
    const body = await req.json().catch(() => null);
    if (name === "directory.search") {
      const r = await search(body);
      if (r.error) return fail(r.error.code, requestId, { field: "field" in r.error ? r.error.field : undefined, extra: cors });
      return ok(r.data, requestId, clock, 200, cors);
    }
    const input = DirectoryCitiesInput.safeParse(body ?? {});
    if (!input.success) return fail("VALIDATION_ERROR", requestId, { extra: cors });
    const r = await deps.anonRpc("discovery_cities", { p_category: input.data.category }).catch(() => null);
    if (!r) return fail("PROVIDER_UNAVAILABLE", requestId, { extra: cors });
    if (r.error) return fail(mapDbError(r.error).code, requestId, { extra: cors });
    const out = DirectoryCitiesOutput.safeParse(r.data);
    if (!out.success) return fail("INTERNAL_ERROR", requestId, { extra: cors });
    return ok(out.data, requestId, clock, 200, cors);
  }

  async function page(req: Request, requestId: string): Promise<Response> {
    if (req.method !== "GET" && req.method !== "HEAD") return new Response("Use GET.", { status: 405 });
    const q = new URL(req.url).searchParams;
    const r = await search({ uf: q.get("uf") ?? "", city_slug: q.get("city") ?? "", category: q.get("category") || null });
    const headers = { "Content-Type": "text/html; charset=utf-8", "X-Request-Id": requestId, "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'" };
    if (!r.data) {
      const status = r.error?.code === "VALIDATION_ERROR" ? 404 : 503;
      return new Response("<!doctype html><title>Página não encontrada</title><p>Página não encontrada.</p>", { status, headers: { ...headers, "Cache-Control": "no-store" } });
    }
    const html = renderDirectoryPage(r.data, { uf: r.input.uf, city_slug: r.input.city_slug, category: r.input.category }, { origin: deps.publicAppUrl });
    return new Response(req.method === "HEAD" ? null : html, { status: 200, headers: { ...headers, "Cache-Control": "public, max-age=600" } });
  }
}
