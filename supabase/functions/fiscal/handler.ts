// Edge Function `fiscal` (P16): NFS-e no caso elegível. Rotas do dono pelo rpc-handler (JWT; o banco autoriza, decide a
// elegibilidade e o ambiente). Emissão e cancelamento: o banco grava o pedido, a função fala com o provedor do ambiente
// e grava a resposta pela RPC de backend (incerto → `unknown`, consultado depois pelo `fiscal.sync`). A credencial é
// consultada no provedor; nenhum certificado passa por aqui. Emitir não toca recebível nem caixa.
import { z } from "zod";
import {
  FiscalCancelInput, FiscalCredentialCheckInput, FiscalDocument, FiscalDocumentOutput, FiscalEmitInput, FiscalFolderInput, FiscalFolderOutput, FiscalGetInput,
  FiscalOverview, FiscalProfileSaveInput, FiscalRepresentationInput, TENANT_HEADER,
} from "../_shared/contracts/index.ts";
import type { FiscalEnv, FiscalEmitRequest, FiscalProviderPort } from "../_shared/domain/fiscal/providers.ts";
import { mapDbError } from "../_shared/http/errors.ts";
import { corsHeaders, fail, isUuid, ok, requestIdFrom, systemClock } from "../_shared/http/respond.ts";
import { createRpcHandler, type Route, route, type RpcHandlerDeps, type RpcResult } from "../_shared/http/rpc-handler.ts";

export const SYNC_SECRET_HEADER = "X-Tinindo-Sync-Secret";

export interface FiscalDeps extends RpcHandlerDeps {
  serviceRpc(fn: string, args: Record<string, unknown>): Promise<RpcResult>;
  providers: Record<FiscalEnv, FiscalProviderPort>;
  syncSecret: string;
}

const emitArgs = (i: z.output<typeof FiscalEmitInput>) => ({ p_receivable_id: i.receivable_id, p_taker_name: i.taker_name, p_taker_document: i.taker_document,
  p_description: i.description, p_amount_cents: i.amount_cents, p_competence_date: i.competence_date });
const cancelArgs = (i: z.output<typeof FiscalCancelInput>) => ({ p_document_id: i.document_id, p_expected_version: i.expected_version, p_reason: i.reason });

export const FISCAL_ROUTES: Record<string, Route> = {
  "fiscal.get": route({ rpc: "fiscal_get", input: FiscalGetInput, output: FiscalOverview, command: false, args: () => ({}) }),
  "fiscal.profile_save": route({
    rpc: "fiscal_profile_save", input: FiscalProfileSaveInput, output: FiscalOverview, command: true,
    args: (i) => ({ p_expected_version: i.expected_version, p_legal_name: i.legal_name, p_cnpj: i.cnpj, p_regime: i.regime, p_municipality_ibge: i.municipality_ibge, p_service_code: i.service_code }),
  }),
  "fiscal.representation": route({
    rpc: "fiscal_representation_set", input: FiscalRepresentationInput, output: FiscalOverview, command: true,
    args: (i) => (i.action === "grant" ? { p_action: "grant", p_terms_hash: i.terms_hash, p_valid_days: i.valid_days } : { p_action: "revoke", p_terms_hash: null, p_valid_days: null }),
  }),
  "fiscal.folder": route({ rpc: "fiscal_folder", input: FiscalFolderInput, output: FiscalFolderOutput, command: false, args: (i) => ({ p_month: i.month }) }),
  // Abaixo: a mesma autorização/idempotência, com pós-processamento na função (provedor).
  "fiscal.credential_check": route({ rpc: "fiscal_credential_target", input: FiscalCredentialCheckInput, output: FiscalOverview, command: false, args: () => ({}) }),
  "fiscal.emit": route({ rpc: "fiscal_emit", input: FiscalEmitInput, output: FiscalDocumentOutput, command: true, args: emitArgs }),
  "fiscal.cancel": route({ rpc: "fiscal_cancel", input: FiscalCancelInput, output: FiscalDocumentOutput, command: true, args: cancelArgs }),
};

/** Corpo bruto das RPCs de emissão/cancelamento: a nota + o pedido ao provedor (só na primeira chamada; replay não reenvia). */
const EmitRaw = z.object({ document: FiscalDocument, request: z.custom<FiscalEmitRequest>().optional() });
const CancelRaw = z.object({ document: FiscalDocument, request: z.object({ provider_ref: z.string(), environment: z.enum(["homologacao", "producao"]), number: z.string().nullable(), reason: z.string() }).optional() });
const RAW_ROUTES: Record<string, Route> = {
  "fiscal.emit": route({ rpc: "fiscal_emit", input: FiscalEmitInput, output: EmitRaw, command: true, args: emitArgs }),
  "fiscal.cancel": route({ rpc: "fiscal_cancel", input: FiscalCancelInput, output: CancelRaw, command: true, args: cancelArgs }),
};
const ROUTE_RE = /\/fiscal\/([a-z_.]+)\/?$/;

export function createFiscalHandler(deps: FiscalDeps) {
  const clock = deps.clock ?? systemClock;
  if (deps.syncSecret.length < 32) throw new Error("FISCAL_SYNC_SECRET precisa de pelo menos 32 caracteres");
  const { "fiscal.credential_check": _c, "fiscal.emit": _e, "fiscal.cancel": _x, ...plain } = FISCAL_ROUTES;
  const owner = createRpcHandler("fiscal", plain, deps);
  const raw = createRpcHandler("fiscal", RAW_ROUTES, deps);
  const body = async (res: Response) => ((await res.clone().json().catch(() => null)) as { data?: unknown } | null)?.data;
  const passthrough = (res: Response, cors: Record<string, string>) => new Response(res.body, { status: res.status, headers: { ...Object.fromEntries(res.headers), ...cors } });

  return async (req: Request): Promise<Response> => {
    const name = ROUTE_RE.exec(new URL(req.url).pathname)?.[1] ?? "";
    const started = clock.now().getTime();
    const requestId = requestIdFrom(req);
    const cors = corsHeaders(req, deps.allowedOrigins);
    let res: Response;
    if (name === "fiscal.emit") res = await emit(req, requestId, cors);
    else if (name === "fiscal.cancel") res = await cancel(req, requestId, cors);
    else if (name === "fiscal.credential_check") res = await credential(req, requestId, cors);
    else if (name === "fiscal.sync") res = await sync(req, requestId);
    else return owner(req);
    deps.log?.({ fn: "fiscal", route: name, request_id: requestId, status: res.status, ms: clock.now().getTime() - started });
    return res;
  };

  async function emit(req: Request, requestId: string, cors: Record<string, string>): Promise<Response> {
    const res = await raw(req);
    if (!res.ok) return passthrough(res, cors);
    const parsed = EmitRaw.safeParse(await body(res));
    if (!parsed.success) return fail("INTERNAL_ERROR", requestId, { extra: cors });
    let doc = parsed.data.document;
    const request = parsed.data.request;
    // Replay (mesma chave): nada é reenviado ao provedor; devolve a nota como está.
    if (request && doc.status === "submitting") {
      const provider = deps.providers[request.environment];
      let outcome: Awaited<ReturnType<FiscalProviderPort["emit"]>>;
      if (!provider?.configured || !provider.environments.includes(request.environment)) outcome = { outcome: "rejected", reason: "Provedor fiscal não configurado para este ambiente." };
      else {
        try {
          outcome = await provider.emit(request);
        } catch {
          outcome = { outcome: "unknown" };
        }
      }
      const r = await deps.serviceRpc("fiscal_emit_result", {
        p_document_id: doc.id, p_outcome: outcome.outcome,
        p_protocol: outcome.outcome === "authorized" || outcome.outcome === "processing" ? outcome.protocol : null,
        p_number: outcome.outcome === "authorized" ? outcome.number : null,
        p_verification_code: outcome.outcome === "authorized" ? outcome.verification_code : null,
        p_pdf_url: outcome.outcome === "authorized" ? outcome.pdf_url : null,
        p_xml_url: outcome.outcome === "authorized" ? outcome.xml_url : null,
        p_reason: outcome.outcome === "rejected" ? outcome.reason : null,
      }).catch(() => null);
      const updated = FiscalDocument.safeParse((r?.data as { document?: unknown } | null)?.document);
      if (updated.success) doc = updated.data;
      else doc = { ...doc, status: "unknown" };
    }
    return ok({ document: doc }, requestId, clock, 201, cors);
  }

  async function cancel(req: Request, requestId: string, cors: Record<string, string>): Promise<Response> {
    const res = await raw(req);
    if (!res.ok) return passthrough(res, cors);
    const parsed = CancelRaw.safeParse(await body(res));
    if (!parsed.success) return fail("INTERNAL_ERROR", requestId, { extra: cors });
    let doc = parsed.data.document;
    const request = parsed.data.request;
    if (request && doc.status === "cancel_requested") {
      const provider = deps.providers[request.environment];
      const outcome = provider?.configured ? await provider.cancel(request.provider_ref, request.environment, request.reason).catch(() => null) : null;
      // Sem resposta do provedor, o pedido fica registrado e é tentado de novo pelo sync.
      if (outcome) {
        const r = await deps.serviceRpc("fiscal_cancel_result", { p_document_id: doc.id, p_outcome: outcome.outcome, p_reason: outcome.outcome === "refused" ? outcome.reason : null }).catch(() => null);
        const updated = FiscalDocument.safeParse((r?.data as { document?: unknown } | null)?.document);
        if (updated.success) doc = updated.data;
      }
    }
    return ok({ document: doc }, requestId, clock, 200, cors);
  }

  async function credential(req: Request, requestId: string, cors: Record<string, string>): Promise<Response> {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (req.method !== "POST") return fail("VALIDATION_ERROR", requestId, { message: "Use POST.", extra: cors });
    const auth = req.headers.get("Authorization") ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    if (!token) return fail("AUTH_REQUIRED", requestId, { extra: cors });
    const tenantId = req.headers.get(TENANT_HEADER);
    if (!isUuid(tenantId)) return fail("VALIDATION_ERROR", requestId, { field: "tenant_id", message: "Selecione um negócio.", extra: cors });
    let target: RpcResult;
    try {
      target = await deps.rpc(token, "fiscal_credential_target", { p_tenant_id: tenantId });
    } catch {
      return fail("PROVIDER_UNAVAILABLE", requestId, { extra: cors });
    }
    if (target.error) {
      const m = mapDbError(target.error);
      return fail(m.code, requestId, { field: m.field, extra: cors });
    }
    const t = target.data as { environment?: FiscalEnv; cnpj?: string } | null;
    if (!t?.environment || !t.cnpj) return fail("INTERNAL_ERROR", requestId, { extra: cors });
    const provider = deps.providers[t.environment];
    if (!provider?.configured) return fail("PROVIDER_UNAVAILABLE", requestId, { message: "O provedor fiscal não está configurado neste ambiente.", extra: cors });
    const status = await provider.credential(t.cnpj, t.environment).catch(() => null);
    if (!status) return fail("PROVIDER_UNAVAILABLE", requestId, { message: "O provedor fiscal não respondeu. Nada foi alterado.", extra: cors });
    const r = await deps.serviceRpc("fiscal_credential_record", { p_tenant_id: tenantId, p_environment: t.environment, p_status: status.status, p_valid_until: status.valid_until }).catch(() => null);
    const out = FiscalOverview.safeParse(r?.data);
    if (!out.success) return fail("INTERNAL_ERROR", requestId, { extra: cors });
    return ok(out.data, requestId, clock, 200, cors);
  }

  /** Cron: consulta pela referência as notas incertas, em processamento ou presas no envio. Nunca reenvia. */
  async function sync(req: Request, requestId: string): Promise<Response> {
    if (req.method !== "POST") return fail("VALIDATION_ERROR", requestId, { message: "Use POST." });
    if (req.headers.get(SYNC_SECRET_HEADER) !== deps.syncSecret) return fail("FORBIDDEN", requestId);
    const claim = await deps.serviceRpc("fiscal_sync_claim", { p_batch: 50 }).catch(() => null);
    const items = ((claim?.data as { items?: { document_id: string; provider_ref: string; environment: FiscalEnv }[] } | null)?.items) ?? [];
    let resolved = 0;
    let still = 0;
    for (const it of items) {
      const provider = deps.providers[it.environment];
      const r = provider?.configured ? await provider.query(it.provider_ref, it.environment).catch(() => null) : null;
      if (!r || r.outcome === "unknown") {
        still += 1;
        continue;
      }
      await deps.serviceRpc("fiscal_emit_result", {
        p_document_id: it.document_id, p_outcome: r.outcome,
        p_protocol: r.outcome === "authorized" || r.outcome === "processing" ? r.protocol : null,
        p_number: r.outcome === "authorized" ? r.number : null, p_verification_code: r.outcome === "authorized" ? r.verification_code : null,
        p_pdf_url: r.outcome === "authorized" ? r.pdf_url : null, p_xml_url: r.outcome === "authorized" ? r.xml_url : null,
        p_reason: r.outcome === "rejected" ? r.reason : null,
      }).catch(() => null);
      if (r.outcome === "processing") still += 1;
      else resolved += 1;
    }
    return ok({ checked: items.length, resolved, still_pending: still }, requestId, clock, 200, {});
  }
}
