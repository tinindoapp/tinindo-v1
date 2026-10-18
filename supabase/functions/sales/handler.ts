// Edge Function `sales` (P11): orçamentos versionados e aceite pelo link.
// Rotas do dono: uma RPC transacional cada (ver _shared/http/rpc-handler.ts).
// Rotas do link (quote.view, quote.accept, quote.decline): anônimas, token no CORPO de um POST (nunca na query),
// o banco guarda só o hash. Ver não aceita; aceitar/recusar citam versão + hash do que o cliente viu.
import type { z } from "zod";
import {
  IDEMPOTENCY_HEADER,
  IdempotencyKey,
  SalesQuoteCreateInput,
  SalesQuoteDecideInput,
  SalesQuoteDecideOutput,
  SalesQuoteDetailOutput,
  SalesQuoteListInput,
  SalesQuoteListOutput,
  SalesQuoteOutput,
  SalesQuotePublicView,
  SalesQuoteRefInput,
  SalesQuoteReviseInput,
  SalesQuoteSendInput,
  SalesQuoteSendOutput,
  SalesQuoteTokenInput,
} from "../_shared/contracts/index.ts";
import { mapDbError } from "../_shared/http/errors.ts";
import { type Clock, corsHeaders, fail, ok, requestIdFrom, systemClock } from "../_shared/http/respond.ts";
import { createRpcHandler, type Route, route, type RpcResult } from "../_shared/http/rpc-handler.ts";

export interface SalesDeps {
  /** accessToken null = chamada anônima (link do orçamento). Nunca service role. */
  rpc(accessToken: string | null, fn: string, args: Record<string, unknown>): Promise<RpcResult>;
  allowedOrigins: readonly string[];
  clock?: Clock;
  log?: (entry: Record<string, unknown>) => void;
}

const content = (i: z.output<typeof SalesQuoteCreateInput> | z.output<typeof SalesQuoteReviseInput>) => ({
  p_title: i.title,
  p_items: i.items.map((x) => ({ service_id: x.service_id ?? null, description: x.description, quantity: x.quantity,
    unit_price_cents: x.unit_price_cents })),
  p_valid_until: i.valid_until,
  p_slot_service_id: i.slot?.service_id ?? null,
  p_slot_starts_at: i.slot?.starts_at ?? null,
  p_notes: i.notes ?? null,
});

export const SALES_ROUTES: Record<string, Route> = {
  "quote.create": route({
    rpc: "sales_quote_create", input: SalesQuoteCreateInput, output: SalesQuoteOutput, command: true,
    args: (i) => ({ p_customer_id: i.customer_id, ...content(i) }),
  }),
  "quote.revise": route({
    rpc: "sales_quote_revise", input: SalesQuoteReviseInput, output: SalesQuoteOutput, command: true,
    args: (i) => ({ p_quote_id: i.quote_id, p_expected_version: i.expected_version, ...content(i) }),
  }),
  "quote.send": route({
    rpc: "sales_quote_send", input: SalesQuoteSendInput, output: SalesQuoteSendOutput, command: true,
    args: (i) => ({ p_quote_id: i.quote_id, p_expected_version: i.expected_version }),
  }),
  "quote.cancel": route({
    rpc: "sales_quote_cancel", input: SalesQuoteRefInput, output: SalesQuoteOutput, command: true,
    args: (i) => ({ p_quote_id: i.quote_id }),
  }),
  "quote.list": route({
    rpc: "sales_quote_list", input: SalesQuoteListInput, output: SalesQuoteListOutput, command: false,
    args: (i) => ({ p_status: i.status ?? null }),
  }),
  "quote.get": route({
    rpc: "sales_quote_get", input: SalesQuoteRefInput, output: SalesQuoteDetailOutput, command: false,
    args: (i) => ({ p_quote_id: i.quote_id }),
  }),
};

interface PublicRoute {
  rpc: string;
  input: z.ZodType;
  output: z.ZodType;
  needsKey: boolean;
  args(input: never): Record<string, unknown>;
}
const publicRoute = <I extends z.ZodType>(r: Omit<PublicRoute, "input" | "args"> & {
  input: I;
  args(input: z.output<I>): Record<string, unknown>;
}): PublicRoute => r as unknown as PublicRoute;

/** Rotas do link: anônimas, sem tenant; o token é a referência e a âncora de idempotência. */
export const SALES_PUBLIC_ROUTES: Record<string, PublicRoute> = {
  "quote.view": publicRoute({
    rpc: "sales_quote_view", input: SalesQuoteTokenInput, output: SalesQuotePublicView, needsKey: false,
    args: (i) => ({ p_token: i.token }),
  }),
  "quote.accept": publicRoute({
    rpc: "sales_quote_accept", input: SalesQuoteDecideInput, output: SalesQuoteDecideOutput, needsKey: true,
    args: (i) => ({ p_token: i.token, p_version_no: i.version_no, p_snapshot_hash: i.snapshot_hash }),
  }),
  "quote.decline": publicRoute({
    rpc: "sales_quote_decline", input: SalesQuoteDecideInput, output: SalesQuoteDecideOutput, needsKey: true,
    args: (i) => ({ p_token: i.token, p_version_no: i.version_no, p_snapshot_hash: i.snapshot_hash }),
  }),
};

const ROUTE_RE = /\/sales\/([a-z_.]+)\/?$/;

export function createSalesHandler(deps: SalesDeps) {
  const clock = deps.clock ?? systemClock;
  const owner = createRpcHandler("sales", SALES_ROUTES, { ...deps, rpc: (token, fn, args) => deps.rpc(token, fn, args) });

  return async (req: Request): Promise<Response> => {
    const name = ROUTE_RE.exec(new URL(req.url).pathname)?.[1] ?? "";
    const spec = Object.hasOwn(SALES_PUBLIC_ROUTES, name) ? SALES_PUBLIC_ROUTES[name] : undefined;
    if (!spec) return owner(req);

    const started = clock.now().getTime();
    const requestId = requestIdFrom(req);
    const cors = corsHeaders(req, deps.allowedOrigins);
    const res = await handlePublic(req, spec, requestId, cors);
    // Log sem token, corpo ou tenant.
    deps.log?.({ fn: "sales", route: name, request_id: requestId, status: res.status, ms: clock.now().getTime() - started });
    return res;
  };

  async function handlePublic(req: Request, spec: PublicRoute, requestId: string, cors: Record<string, string>) {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (req.method !== "POST") return fail("VALIDATION_ERROR", requestId, { message: "Use POST.", extra: cors });
    if (spec.needsKey && !IdempotencyKey.safeParse(req.headers.get(IDEMPOTENCY_HEADER)).success) {
      return fail("VALIDATION_ERROR", requestId, { field: "idempotency_key", message: "Envie o header Idempotency-Key.", extra: cors });
    }
    let body: unknown;
    try {
      body = JSON.parse((await req.text()).slice(0, 4096));
    } catch {
      return fail("NOT_FOUND", requestId, { extra: cors });
    }
    const token = SalesQuoteTokenInput.safeParse(body);
    // Token malformado e inexistente dão a mesma resposta.
    if (!token.success) return fail("NOT_FOUND", requestId, { extra: cors });
    const input = spec.input.safeParse(body);
    if (!input.success) {
      const path = input.error.issues[0]?.path.map(String).join(".");
      return fail("VALIDATION_ERROR", requestId, { field: path || undefined, extra: cors });
    }
    let result: RpcResult;
    try {
      result = await deps.rpc(null, spec.rpc, spec.args(input.data as never));
    } catch {
      return fail("PROVIDER_UNAVAILABLE", requestId, { extra: cors });
    }
    if (result.error) {
      const mapped = mapDbError(result.error);
      return fail(mapped.code, requestId, { field: mapped.field, extra: cors });
    }
    const parsed = spec.output.safeParse(result.data);
    if (!parsed.success) return fail("INTERNAL_ERROR", requestId, { extra: cors });
    return ok(parsed.data, requestId, clock, 200, cors);
  }
}
