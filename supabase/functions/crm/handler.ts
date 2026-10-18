// Edge Function `crm` (P02): clientes, catálogo de serviços e importação mínima.
// Caminho de toda rota: valida entrada no contrato → chama UMA RPC com o JWT do usuário →
// o banco autoriza (app.is_member), aplica idempotência/versão e audita na mesma transação.
// O header X-Tinindo-Tenant é seleção; não concede acesso. Lógica pura, servida por index.ts.
import {
  IDEMPOTENCY_HEADER,
  IdempotencyKey,
  ServiceSaveInput,
  ServiceSaveOutput,
  TENANT_HEADER,
} from "../_shared/contracts/index.ts";
import { type DbErrorLike, mapDbError } from "../_shared/http/errors.ts";
import { canonicalJson, decodeCursor, encodeCursor, sha256Hex } from "../_shared/http/command.ts";
import { type Clock, corsHeaders, fail, isUuid, ok, requestIdFrom, systemClock } from "../_shared/http/respond.ts";
import type { z } from "zod";
import {
  CRM_ROUTES,
  CrmCustomerUpsertInput,
  CrmCustomerUpsertOutput,
  CustomerArchiveInput,
  CustomerArchiveOutput,
  CustomerListOutput,
  CustomerListQuery,
  ImportInput,
  ImportOutput,
  ImportPreviewInput,
  ImportPreviewOutput,
  ServiceListOutput,
  ServiceListQuery,
} from "./contract.ts";

export { canonicalJson, decodeCursor, encodeCursor, sha256Hex };

export type RpcResult = { data: unknown; error: DbErrorLike | null };

export interface CrmDeps {
  /** Chama a RPC com o JWT do usuário (nunca com service role). */
  rpc(accessToken: string, fn: string, args: Record<string, unknown>): Promise<RpcResult>;
  allowedOrigins: readonly string[];
  clock?: Clock;
  log?: (entry: Record<string, unknown>) => void;
}

interface Ctx {
  token: string;
  tenantId: string;
  requestId: string;
  cors: Record<string, string>;
}

const ROUTE_RE = /\/crm\/([a-z_.]+)\/?$/;
const MAX_BODY_BYTES = 512 * 1024;

export function createCrmHandler(deps: CrmDeps) {
  const clock = deps.clock ?? systemClock;

  return async (req: Request): Promise<Response> => {
    const started = clock.now().getTime();
    const requestId = requestIdFrom(req);
    const cors = corsHeaders(req, deps.allowedOrigins);
    const route = ROUTE_RE.exec(new URL(req.url).pathname)?.[1] ?? "";
    const res = await handle(req, route, requestId, cors);
    // Log técnico sem PII: sem tenant, token, query ou corpo.
    deps.log?.({ fn: "crm", route, request_id: requestId, status: res.status, ms: clock.now().getTime() - started });
    return res;
  };

  async function handle(req: Request, route: string, requestId: string, cors: Record<string, string>) {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    const isList = route === CRM_ROUTES.listCustomers || route === CRM_ROUTES.listServices;
    const known = (Object.values(CRM_ROUTES) as string[]).includes(route);
    if (!known) return fail("NOT_FOUND", requestId, { extra: cors });
    if (req.method !== (isList ? "GET" : "POST")) {
      return fail("VALIDATION_ERROR", requestId, { message: isList ? "Use GET." : "Use POST.", extra: cors });
    }

    const auth = req.headers.get("Authorization") ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    if (!token) return fail("AUTH_REQUIRED", requestId, { extra: cors });
    const tenantId = req.headers.get(TENANT_HEADER);
    if (!isUuid(tenantId)) {
      return fail("VALIDATION_ERROR", requestId, { field: "tenant_id", message: "Selecione um negócio.", extra: cors });
    }
    const ctx: Ctx = { token, tenantId, requestId, cors };
    const url = new URL(req.url);

    switch (route) {
      case CRM_ROUTES.listCustomers:
        return listCustomers(ctx, url);
      case CRM_ROUTES.listServices:
        return listServices(ctx, url);
      case CRM_ROUTES.importPreview: {
        const input = await readBody(req, ImportPreviewInput, ctx);
        if (input instanceof Response) return input;
        return query(ctx, "crm_customer_import_preview", { p_tenant_id: tenantId, p_rows: input.rows }, ImportPreviewOutput);
      }
      case CRM_ROUTES.upsertCustomer:
        return command(req, ctx, "customer.upsert", CrmCustomerUpsertInput, CrmCustomerUpsertOutput, (i) => ({
          fn: "crm_customer_upsert",
          args: {
            p_customer_id: i.customer_id ?? null,
            p_expected_version: i.expected_version ?? null,
            p_name: i.name,
            p_phone: i.phone,
            p_email: i.email,
            p_declared_source: i.declared_source,
          },
        }));
      case CRM_ROUTES.archiveCustomer:
        return command(req, ctx, "customer.archive", CustomerArchiveInput, CustomerArchiveOutput, (i) => ({
          fn: "crm_customer_archive",
          args: { p_customer_id: i.customer_id, p_expected_version: i.expected_version, p_archived: i.archived },
        }));
      case CRM_ROUTES.importCustomers:
        return command(req, ctx, "customer.import", ImportInput, ImportOutput, (i) => ({
          fn: "crm_customer_import",
          args: { p_rows: i.rows },
        }));
      case CRM_ROUTES.saveService:
        return command(req, ctx, "service.save", ServiceSaveInput, ServiceSaveOutput, (i) => ({
          fn: "crm_service_save",
          args: {
            p_service_id: i.service_id ?? null,
            p_expected_version: i.expected_version ?? null,
            p_name: i.name,
            p_duration_min: i.duration_min,
            p_buffer_before_min: i.buffer_before_min,
            p_buffer_after_min: i.buffer_after_min,
            p_base_price_cents: i.base_price_cents,
            p_min_price_cents: i.min_price_cents,
            p_estimated_cost_cents: i.estimated_cost_cents,
            p_fee_bps: i.fee_bps,
            p_active: i.active,
          },
        }));
    }
    return fail("NOT_FOUND", requestId, { extra: cors });
  }

  async function listCustomers(ctx: Ctx, url: URL) {
    const parsed = CustomerListQuery.safeParse(Object.fromEntries(url.searchParams));
    if (!parsed.success) return invalid(parsed.error, ctx);
    const cursor = decodeCursor(parsed.data.cursor);
    if (cursor === false) return fail("VALIDATION_ERROR", ctx.requestId, { field: "cursor", extra: ctx.cors });
    return list(ctx, "crm_customer_list", {
      p_tenant_id: ctx.tenantId,
      p_query: parsed.data.q || null,
      p_include_archived: parsed.data.include_archived,
      p_after_key: cursor?.key ?? null,
      p_after_id: cursor?.id ?? null,
      p_limit: parsed.data.limit,
    }, CustomerListOutput);
  }

  async function listServices(ctx: Ctx, url: URL) {
    const parsed = ServiceListQuery.safeParse(Object.fromEntries(url.searchParams));
    if (!parsed.success) return invalid(parsed.error, ctx);
    const cursor = decodeCursor(parsed.data.cursor);
    if (cursor === false) return fail("VALIDATION_ERROR", ctx.requestId, { field: "cursor", extra: ctx.cors });
    return list(ctx, "crm_service_list", {
      p_tenant_id: ctx.tenantId,
      p_include_inactive: parsed.data.include_inactive,
      p_after_key: cursor?.key ?? null,
      p_after_id: cursor?.id ?? null,
      p_limit: parsed.data.limit,
    }, ServiceListOutput);
  }

  async function list(ctx: Ctx, fn: string, args: Record<string, unknown>, out: z.ZodType) {
    const result = await callRpc(ctx, fn, args);
    if (result instanceof Response) return result;
    const raw = result as { items?: unknown; next?: { key: string; id: string } | null } | null;
    const shaped = { items: raw?.items, next_cursor: raw?.next ? encodeCursor(raw.next) : null };
    return respond(ctx, shaped, out, 200);
  }

  async function query(ctx: Ctx, fn: string, args: Record<string, unknown>, out: z.ZodType) {
    const result = await callRpc(ctx, fn, args);
    if (result instanceof Response) return result;
    return respond(ctx, result, out, 200);
  }

  async function command<I extends z.ZodType>(
    req: Request,
    ctx: Ctx,
    operation: string,
    schema: I,
    out: z.ZodType,
    toRpc: (input: z.output<I>) => { fn: string; args: Record<string, unknown> },
  ) {
    const key = IdempotencyKey.safeParse(req.headers.get(IDEMPOTENCY_HEADER));
    if (!key.success) {
      return fail("VALIDATION_ERROR", ctx.requestId, {
        field: "idempotency_key",
        message: "Envie o header Idempotency-Key.",
        extra: ctx.cors,
      });
    }
    const input = await readBody(req, schema, ctx);
    if (input instanceof Response) return input;
    const { fn, args } = toRpc(input);
    const result = await callRpc(ctx, fn, {
      p_tenant_id: ctx.tenantId,
      ...args,
      p_idem_key: key.data,
      // O hash cobre a operação e a entrada normalizada (com defaults), nunca a chave.
      p_request_hash: await sha256Hex(canonicalJson({ operation, input })),
      p_request_id: ctx.requestId,
    });
    if (result instanceof Response) return result;
    const envelope = result as { status_code?: unknown; body?: unknown } | null;
    const status = typeof envelope?.status_code === "number" ? envelope.status_code : 0;
    if (status < 200 || status > 299) return fail("INTERNAL_ERROR", ctx.requestId, { extra: ctx.cors });
    return respond(ctx, envelope?.body, out, status);
  }

  async function callRpc(ctx: Ctx, fn: string, args: Record<string, unknown>): Promise<unknown> {
    let result: RpcResult;
    try {
      result = await deps.rpc(ctx.token, fn, args);
    } catch {
      return fail("PROVIDER_UNAVAILABLE", ctx.requestId, { extra: ctx.cors });
    }
    if (result.error) {
      const mapped = mapDbError(result.error);
      return fail(mapped.code, ctx.requestId, { field: mapped.field, extra: ctx.cors });
    }
    return result.data;
  }

  function respond(ctx: Ctx, data: unknown, out: z.ZodType, status: number) {
    const parsed = out.safeParse(data);
    if (!parsed.success) return fail("INTERNAL_ERROR", ctx.requestId, { extra: ctx.cors });
    return ok(parsed.data, ctx.requestId, clock, status, ctx.cors);
  }
}

async function readBody<T extends z.ZodType>(req: Request, schema: T, ctx: Ctx): Promise<z.output<T> | Response> {
  const text = await req.text().catch(() => "");
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    return fail("VALIDATION_ERROR", ctx.requestId, { message: "Corpo grande demais.", extra: ctx.cors });
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return fail("VALIDATION_ERROR", ctx.requestId, { message: "JSON inválido.", extra: ctx.cors });
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) return invalid(parsed.error, ctx);
  return parsed.data;
}

function invalid(error: z.ZodError, ctx: Ctx): Response {
  const path = error.issues[0]?.path.map(String).join(".");
  return fail("VALIDATION_ERROR", ctx.requestId, { field: path || undefined, extra: ctx.cors });
}
