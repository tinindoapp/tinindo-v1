// Edge Function `presence` (P17): site padronizado, domínio do cliente e acesso delegado ao Google, com entregas.
// Dono e operação pelo rpc-handler (JWT do usuário; o banco autoriza). Verificação de domínio: o dono pede, a função
// consulta o TXT no DNS pela porta e grava o observado pela RPC de backend (o banco compara com o token e decide).
// Público: leitura da versão publicada (JSON) e a página em HTML indexável (GET /presence/page?slug= ou ?host=).
import {
  DeliveryRecordInput, DeliveryRecordOutput, DomainAddInput, DomainCheckInput, DomainCheckOutput, DomainRemoveInput, GoogleSetInput, PresenceGetInput,
  PresenceOverview, PublicSiteInput, PublicSiteOutput, SitePublishInput, SiteRestoreInput, SiteSaveInput, SiteUnpublishInput, TENANT_HEADER,
} from "../_shared/contracts/index.ts";
import { renderSitePage } from "../_shared/domain/presence/render.ts";
import { mapDbError } from "../_shared/http/errors.ts";
import { corsHeaders, fail, isUuid, ok, requestIdFrom, systemClock } from "../_shared/http/respond.ts";
import { createRpcHandler, type Route, route, type RpcHandlerDeps, type RpcResult } from "../_shared/http/rpc-handler.ts";

/** Porta do DNS: valores TXT do nome; nome inexistente → []; falha de consulta → exceção. */
export type ResolveTxt = (name: string) => Promise<string[]>;

export interface PresenceDeps extends RpcHandlerDeps {
  /** RPC de backend (chave de serviço): só `presence_domain_record_check`. */
  serviceRpc(fn: string, args: Record<string, unknown>): Promise<RpcResult>;
  /** RPC anônima da página publicada. */
  anonRpc(fn: string, args: Record<string, unknown>): Promise<RpcResult>;
  resolveTxt: ResolveTxt;
  /** Endereço público do app (link canônico e agendamento). */
  publicAppUrl: string;
  /** Destino do CNAME no ambiente; null enquanto não houver projeto hospedado. */
  cnameTarget: string | null;
}

const withCname = (cname: string | null) => (data: unknown) => (data && typeof data === "object" ? { ...data, cname_target: cname } : data);

export function presenceRoutes(cname: string | null): Record<string, Route> {
  const shape = withCname(cname);
  return {
    "presence.get": route({ rpc: "presence_get", input: PresenceGetInput, output: PresenceOverview, command: false, args: () => ({}), shape }),
    "site.save": route({
      rpc: "presence_site_save", input: SiteSaveInput, output: PresenceOverview, command: true, shape,
      args: (i) => ({ p_expected_version: i.expected_version, p_headline: i.headline, p_sections: i.sections, p_theme: i.theme, p_service_ids: i.service_ids }),
    }),
    "site.publish": route({ rpc: "presence_site_publish", input: SitePublishInput, output: PresenceOverview, command: true, shape, args: (i) => ({ p_expected_hash: i.expected_hash }) }),
    "site.unpublish": route({ rpc: "presence_site_unpublish", input: SiteUnpublishInput, output: PresenceOverview, command: true, shape, args: (i) => ({ p_expected_version: i.expected_version }) }),
    "site.restore": route({
      rpc: "presence_site_restore", input: SiteRestoreInput, output: PresenceOverview, command: true, shape,
      args: (i) => ({ p_version_no: i.version_no, p_expected_version: i.expected_version }),
    }),
    "domain.add": route({ rpc: "presence_domain_add", input: DomainAddInput, output: PresenceOverview, command: true, shape, args: (i) => ({ p_hostname: i.hostname }) }),
    "domain.remove": route({
      rpc: "presence_domain_remove", input: DomainRemoveInput, output: PresenceOverview, command: true, shape,
      args: (i) => ({ p_domain_id: i.domain_id, p_expected_version: i.expected_version }),
    }),
    "google.set": route({
      rpc: "presence_google_set", input: GoogleSetInput, output: PresenceOverview, command: true, shape,
      args: (i) => i.action === "grant"
        ? { p_action: "grant", p_profile_name: i.profile_name, p_profile_url: i.profile_url, p_expected_version: i.expected_version }
        : { p_action: "revoke", p_profile_name: null, p_profile_url: null, p_expected_version: i.expected_version },
    }),
    "ops.presence_delivery": route({
      rpc: "presence_delivery_record", input: DeliveryRecordInput, output: DeliveryRecordOutput, command: true,
      args: (i) => ({ p_kind: i.kind, p_summary: i.summary, p_evidence_url: i.evidence_url, p_service_order_id: i.service_order_id }),
    }),
    // Verificação: a autorização é a RPC do dono (presence_domain_check_target); o resto acontece na função (abaixo).
    "domain.check": route({ rpc: "presence_domain_check_target", input: DomainCheckInput, output: DomainCheckOutput, command: false, args: (i) => ({ p_domain_id: i.domain_id }) }),
  };
}

/** Rotas para o registro e os testes de contrato (o destino do CNAME só muda a resposta, não o contrato). */
export const PRESENCE_ROUTES = presenceRoutes(null);
export const PRESENCE_PUBLIC = { "presence.public_site": { rpc: "presence_public_site", input: PublicSiteInput, output: PublicSiteOutput } } as const;

const ROUTE_RE = /\/presence\/([a-z_.]+)\/?$/;

export function createPresenceHandler(deps: PresenceDeps) {
  const clock = deps.clock ?? systemClock;
  const routes = presenceRoutes(deps.cnameTarget);
  const { "domain.check": _check, ...ownerRoutes } = routes;
  const owner = createRpcHandler("presence", ownerRoutes, deps);

  return async (req: Request): Promise<Response> => {
    const name = ROUTE_RE.exec(new URL(req.url).pathname)?.[1] ?? "";
    const started = clock.now().getTime();
    const requestId = requestIdFrom(req);
    const cors = corsHeaders(req, deps.allowedOrigins);
    let res: Response;
    if (name === "domain.check") res = await check(req, requestId, cors);
    else if (name === "presence.public_site") res = await publicSite(req, requestId, cors);
    else if (name === "page") res = await page(req, requestId);
    else return owner(req);
    deps.log?.({ fn: "presence", route: name, request_id: requestId, status: res.status, ms: clock.now().getTime() - started });
    return res;
  };

  async function check(req: Request, requestId: string, cors: Record<string, string>): Promise<Response> {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (req.method !== "POST") return fail("VALIDATION_ERROR", requestId, { message: "Use POST.", extra: cors });
    const auth = req.headers.get("Authorization") ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    if (!token) return fail("AUTH_REQUIRED", requestId, { extra: cors });
    const tenantId = req.headers.get(TENANT_HEADER);
    if (!isUuid(tenantId)) return fail("VALIDATION_ERROR", requestId, { field: "tenant_id", message: "Selecione um negócio.", extra: cors });
    const input = DomainCheckInput.safeParse(await req.json().catch(() => null));
    if (!input.success) return fail("VALIDATION_ERROR", requestId, { field: "domain_id", extra: cors });
    // 1 · O dono autoriza (e o banco aplica o intervalo entre consultas).
    let target: RpcResult;
    try {
      target = await deps.rpc(token, "presence_domain_check_target", { p_tenant_id: tenantId, p_domain_id: input.data.domain_id });
    } catch {
      return fail("PROVIDER_UNAVAILABLE", requestId, { extra: cors });
    }
    if (target.error) {
      const m = mapDbError(target.error);
      return fail(m.code, requestId, { field: m.field, extra: cors });
    }
    const t = target.data as { domain_id?: unknown; txt_name?: unknown } | null;
    if (typeof t?.txt_name !== "string" || typeof t.domain_id !== "string") return fail("INTERNAL_ERROR", requestId, { extra: cors });
    // 2 · A função consulta o DNS público. Falha de consulta é registrada como tal (nunca vira "verificado").
    let observed: string[] = [];
    let lookupFailed = false;
    try {
      observed = (await deps.resolveTxt(t.txt_name)).slice(0, 10);
    } catch {
      lookupFailed = true;
    }
    // 3 · O banco compara com o token guardado e decide.
    const r = await deps.serviceRpc("presence_domain_record_check", { p_domain_id: t.domain_id, p_observed: observed, p_lookup_failed: lookupFailed }).catch(() => null);
    if (!r || r.error) return fail("PROVIDER_UNAVAILABLE", requestId, { extra: cors });
    const parsed = DomainCheckOutput.safeParse(r.data);
    if (!parsed.success) return fail("INTERNAL_ERROR", requestId, { extra: cors });
    return ok(parsed.data, requestId, clock, 200, cors);
  }

  async function fetchPublic(input: unknown): Promise<{ data?: ReturnType<typeof PublicSiteOutput.parse>; error?: ReturnType<typeof mapDbError> | "invalid" }> {
    const parsed = PublicSiteInput.safeParse(input);
    if (!parsed.success) return { error: "invalid" };
    const args = "host" in parsed.data ? { p_slug: null, p_host: parsed.data.host } : { p_slug: parsed.data.slug, p_host: null };
    const r = await deps.anonRpc("presence_public_site", args).catch(() => null);
    if (!r) return { error: { code: "PROVIDER_UNAVAILABLE" } };
    if (r.error) return { error: mapDbError(r.error) };
    const out = PublicSiteOutput.safeParse(r.data);
    return out.success ? { data: out.data } : { error: { code: "INTERNAL_ERROR" } };
  }

  async function publicSite(req: Request, requestId: string, cors: Record<string, string>): Promise<Response> {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (req.method !== "POST") return fail("VALIDATION_ERROR", requestId, { message: "Use POST.", extra: cors });
    const r = await fetchPublic(await req.json().catch(() => null));
    if (r.error === "invalid") return fail("VALIDATION_ERROR", requestId, { extra: cors });
    if (r.error) return fail(r.error.code, requestId, { extra: cors });
    return ok(r.data, requestId, clock, 200, cors);
  }

  /** HTML indexável. Sem site publicado: 404 sem detalhes. Cache curto: tirar do ar vale em minutos. */
  async function page(req: Request, requestId: string): Promise<Response> {
    if (req.method !== "GET" && req.method !== "HEAD") return new Response("Use GET.", { status: 405 });
    const q = new URL(req.url).searchParams;
    const r = await fetchPublic(q.get("host") ? { host: q.get("host") } : { slug: q.get("slug") ?? "" });
    const headers = { "Content-Type": "text/html; charset=utf-8", "X-Request-Id": requestId, "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; form-action 'none'" };
    if (!r.data) {
      const status = r.error === "invalid" || r.error?.code === "NOT_FOUND" ? 404 : 503;
      return new Response("<!doctype html><title>Página não encontrada</title><p>Página não encontrada.</p>", { status, headers: { ...headers, "Cache-Control": "no-store" } });
    }
    return new Response(req.method === "HEAD" ? null : renderSitePage(r.data, { origin: deps.publicAppUrl }),
      { status: 200, headers: { ...headers, "Cache-Control": "public, max-age=300" } });
  }
}
