// Edge Function `privacy` (P57, D26): exportar e eliminar dados, só o dono do negócio.
// - Listas, eliminação e cancelamento: "rota → uma RPC" (_shared/http/rpc-handler.ts). O banco decide dono,
//   carência, idempotência e trilha.
// - Exportar: 1) `privacy_export_start` reserva o pedido e o caminho; 2) `privacy_export_data` monta o JSON (só quem
//   pediu, só enquanto gera); 3) o arquivo vai para o bucket privado `privacy-exports` com o JWT do dono (política de
//   Storage confere o pedido); 4) `privacy_export_finish` marca pronto por 24 h; 5) link assinado de 15 minutos.
//   Repetir com a mesma Idempotency-Key devolve o mesmo pedido e um link novo, sem gerar outro arquivo.
// Sem chave secreta: tudo com o JWT do usuário. Log técnico sem negócio, token nem conteúdo.
import { IDEMPOTENCY_HEADER, IdempotencyKey, TENANT_HEADER } from "../_shared/contracts/index.ts";
import { canonicalJson, sha256Hex } from "../_shared/http/command.ts";
import { type DbErrorLike, mapDbError } from "../_shared/http/errors.ts";
import { type Clock, corsHeaders, fail, isUuid, ok, requestIdFrom, systemClock } from "../_shared/http/respond.ts";
import { createRpcHandler, type Route, route, type RpcHandlerDeps, type RpcResult } from "../_shared/http/rpc-handler.ts";
import {
  PrivacyEraseCancelInput,
  PrivacyEraseInput,
  PrivacyEraseOutput,
  PrivacyErasuresListInput,
  PrivacyErasuresListOutput,
  PrivacyExport,
  PrivacyExportInput,
  PrivacyExportLinkInput,
  PrivacyExportOutput,
  PrivacyExportsListInput,
  PrivacyExportsListOutput,
} from "./contract.ts";

export const BUCKET = "privacy-exports";
/** Validade do link assinado. O arquivo vive 24 h; dentro disso o dono gera outro link. */
export const LINK_SECONDS = 15 * 60;

export interface PrivacyStorage {
  /** Grava o arquivo com o JWT do dono (a política do bucket confere o pedido). Repetir no mesmo caminho é ok. */
  upload(accessToken: string, path: string, body: Uint8Array): Promise<void>;
  /** Link assinado para baixar, com validade em segundos. */
  signedUrl(accessToken: string, path: string, seconds: number): Promise<string>;
}

export interface PrivacyDeps extends RpcHandlerDeps {
  storage: PrivacyStorage;
}

export const PRIVACY_ROUTES: Record<string, Route> = {
  "privacy.exports": route({ rpc: "privacy_exports_list", input: PrivacyExportsListInput, output: PrivacyExportsListOutput, command: false, args: () => ({}) }),
  "privacy.erasures": route({ rpc: "privacy_erasures_list", input: PrivacyErasuresListInput, output: PrivacyErasuresListOutput, command: false, args: () => ({}) }),
  "privacy.erase": route({
    rpc: "privacy_erasure_request", input: PrivacyEraseInput, output: PrivacyEraseOutput, command: true,
    args: (i) => ({ p_scope: i.scope, p_customer_id: i.customer_id }),
  }),
  "privacy.erase_cancel": route({
    rpc: "privacy_erasure_cancel", input: PrivacyEraseCancelInput, output: PrivacyEraseOutput, command: true,
    args: (i) => ({ p_erasure_id: i.erasure_id }),
  }),
};

const MAX_BODY_BYTES = 16 * 1024;
const CUSTOM = new Set(["privacy.export", "privacy.export_link"]);

class RpcFailure extends Error {
  constructor(readonly mapped: { code: ReturnType<typeof mapDbError>["code"]; field?: string }) {
    super(mapped.code);
  }
}

export function createPrivacyHandler(deps: PrivacyDeps) {
  const rpcHandler = createRpcHandler("privacy", PRIVACY_ROUTES, deps);
  const clock: Clock = deps.clock ?? systemClock;

  async function rpc(token: string, fn: string, args: Record<string, unknown>): Promise<unknown> {
    let res: RpcResult;
    try {
      res = await deps.rpc(token, fn, args);
    } catch {
      throw new RpcFailure({ code: "PROVIDER_UNAVAILABLE" });
    }
    if (res.error) throw new RpcFailure(mapDbError(res.error as DbErrorLike));
    return res.data;
  }

  async function signed(token: string, path: string) {
    const url = await deps.storage.signedUrl(token, path, LINK_SECONDS);
    return { url, expires_at: new Date(clock.now().getTime() + LINK_SECONDS * 1000).toISOString().replace(/\.\d{3}Z$/, "Z") };
  }

  async function custom(req: Request, name: string, requestId: string, cors: Record<string, string>, meta: Record<string, unknown>): Promise<Response> {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (req.method !== "POST") return fail("VALIDATION_ERROR", requestId, { message: "Use POST.", extra: cors });
    const auth = req.headers.get("Authorization") ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    if (!token) return fail("AUTH_REQUIRED", requestId, { extra: cors });
    const tenantId = req.headers.get(TENANT_HEADER);
    if (!isUuid(tenantId)) return fail("VALIDATION_ERROR", requestId, { field: "tenant_id", message: "Selecione um negócio.", extra: cors });
    const text = await req.text().catch(() => "");
    if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) return fail("VALIDATION_ERROR", requestId, { message: "Corpo grande demais.", extra: cors });
    let json: unknown;
    try {
      json = text.trim() === "" ? {} : JSON.parse(text);
    } catch {
      return fail("VALIDATION_ERROR", requestId, { message: "JSON inválido.", extra: cors });
    }

    try {
      if (name === "privacy.export_link") {
        const input = PrivacyExportLinkInput.safeParse(json);
        if (!input.success) return fail("VALIDATION_ERROR", requestId, { field: "export_id", extra: cors });
        const got = await rpc(token, "privacy_export_get", { p_tenant_id: tenantId, p_export_id: input.data.export_id }) as { export: unknown; storage_path: string };
        const exp = PrivacyExport.parse(got.export);
        if (exp.status !== "ready") return fail("POLICY_REJECTED", requestId, { field: "status", extra: cors });
        const out = PrivacyExportOutput.parse({ export: exp, download: await signed(token, got.storage_path) });
        return ok(out, requestId, clock, 200, cors);
      }

      // privacy.export (comando)
      const key = IdempotencyKey.safeParse(req.headers.get(IDEMPOTENCY_HEADER));
      if (!key.success) return fail("VALIDATION_ERROR", requestId, { field: "idempotency_key", message: "Envie o header Idempotency-Key.", extra: cors });
      const input = PrivacyExportInput.safeParse(json);
      if (!input.success) {
        const path = input.error.issues[0]?.path.map(String).join(".");
        return fail("VALIDATION_ERROR", requestId, { field: path || undefined, extra: cors });
      }
      const envelope = await rpc(token, "privacy_export_start", {
        p_tenant_id: tenantId, p_scope: input.data.scope, p_customer_id: input.data.customer_id,
        p_idem_key: key.data, p_request_hash: await sha256Hex(canonicalJson({ operation: name, input: input.data })), p_request_id: requestId,
      }) as { status_code?: number; body?: { export: unknown; storage_path: string } };
      if (!envelope?.body) return fail("INTERNAL_ERROR", requestId, { extra: cors });
      // A repetição devolve a resposta guardada do primeiro pedido (gerando); o estado de agora vem do banco.
      const id = PrivacyExport.parse(envelope.body.export).id;
      const current = await rpc(token, "privacy_export_get", { p_tenant_id: tenantId, p_export_id: id }) as { export: unknown; storage_path: string };
      const started = PrivacyExport.parse(current.export);
      const path = current.storage_path;
      meta.scope = started.scope;
      let finished: { export: unknown; storage_path: string };
      if (started.status === "generating") {
        const data = await rpc(token, "privacy_export_data", { p_tenant_id: tenantId, p_export_id: started.id });
        const bytes = new TextEncoder().encode(JSON.stringify(data, null, 2));
        meta.bytes = bytes.byteLength;
        try {
          await deps.storage.upload(token, path, bytes);
        } catch {
          return fail("PROVIDER_UNAVAILABLE", requestId, { message: "Não foi possível gravar o arquivo. Tente de novo com a mesma chave.", extra: cors });
        }
        finished = await rpc(token, "privacy_export_finish", { p_tenant_id: tenantId, p_export_id: started.id, p_bytes: bytes.byteLength }) as typeof finished;
      } else {
        // Repetição de um pedido já pronto (ou que falhou: aí o dono pede de novo com outra chave).
        finished = current;
      }
      const exp = PrivacyExport.parse(finished.export);
      if (exp.status !== "ready") return fail("POLICY_REJECTED", requestId, { field: "status", extra: cors });
      const out = PrivacyExportOutput.parse({ export: exp, download: await signed(token, finished.storage_path) });
      return ok(out, requestId, clock, 201, cors);
    } catch (e) {
      if (e instanceof RpcFailure) return fail(e.mapped.code, requestId, { field: e.mapped.field, extra: cors });
      return fail("PROVIDER_UNAVAILABLE", requestId, { extra: cors });
    }
  }

  return async (req: Request): Promise<Response> => {
    const name = /\/privacy\/([a-z_.]+)\/?$/.exec(new URL(req.url).pathname)?.[1] ?? "";
    if (!CUSTOM.has(name)) return rpcHandler(req);
    const started = clock.now().getTime();
    const requestId = requestIdFrom(req);
    const meta: Record<string, unknown> = {};
    const res = await custom(req, name, requestId, corsHeaders(req, deps.allowedOrigins), meta);
    deps.log?.({ fn: "privacy", route: name, request_id: requestId, status: res.status, ms: clock.now().getTime() - started, ...meta });
    return res;
  };
}
