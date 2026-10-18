// Edge Function `waitlist` (P06). Rotas do dono: uma RPC transacional cada (ver _shared/http/rpc-handler.ts).
// Rotas do link (offer_view, accept_offer, decline_offer): anônimas, token no CORPO de um POST (nunca na query),
// o banco guarda só o hash. Abrir o link não aceita; aceitar é POST idempotente pelo próprio token.
import type { z } from "zod";
import {
  BookingOutput,
  ConsentRecordInput,
  ConsentRevokeInput,
  ConsentRevokeOutput,
  ContactConsent,
  IDEMPOTENCY_HEADER,
  IdempotencyKey,
  WaitlistAcceptOfferInput,
  WaitlistDeclineOutput,
  WaitlistEntry,
  WaitlistJoinInput,
  WaitlistListInput,
  WaitlistListOutput,
  WaitlistOffer,
  WaitlistOfferRefInput,
  WaitlistOfferView,
  WaitlistPrepareOfferInput,
  WaitlistWithdrawInput,
} from "../_shared/contracts/index.ts";
import { mapDbError } from "../_shared/http/errors.ts";
import { type Clock, corsHeaders, fail, ok, requestIdFrom, systemClock } from "../_shared/http/respond.ts";
import { createRpcHandler, type Route, route, type RpcResult } from "../_shared/http/rpc-handler.ts";

export interface WaitlistDeps {
  /** accessToken null = chamada anônima (link da oferta). Nunca service role. */
  rpc(accessToken: string | null, fn: string, args: Record<string, unknown>): Promise<RpcResult>;
  allowedOrigins: readonly string[];
  clock?: Clock;
  log?: (entry: Record<string, unknown>) => void;
}

export const WAITLIST_ROUTES: Record<string, Route> = {
  "consent.record": route({
    rpc: "consent_record", input: ConsentRecordInput, output: ContactConsent, command: true,
    args: (i) => ({ p_customer_id: i.customer_id, p_purpose: i.purpose, p_channel: i.channel }),
  }),
  "consent.revoke": route({
    rpc: "consent_revoke", input: ConsentRevokeInput, output: ConsentRevokeOutput, command: true,
    args: (i) => ({ p_consent_id: i.consent_id }),
  }),
  "waitlist.join": route({
    rpc: "waitlist_join", input: WaitlistJoinInput, output: WaitlistEntry, command: true,
    args: (i) => ({
      p_customer_id: i.customer_id, p_service_id: i.service_id, p_windows: i.acceptable_windows,
      p_consent_id: i.consent_id, p_valid_until: i.valid_until,
    }),
  }),
  "waitlist.withdraw": route({
    rpc: "waitlist_withdraw", input: WaitlistWithdrawInput, output: WaitlistEntry, command: true,
    args: (i) => ({ p_entry_id: i.entry_id, p_expected_version: i.expected_version }),
  }),
  "waitlist.prepare_offer": route({
    rpc: "waitlist_prepare_offer", input: WaitlistPrepareOfferInput, output: WaitlistOffer, command: true,
    args: (i) => ({ p_entry_id: i.entry_id, p_starts_at: i.slot.starts_at, p_ends_at: i.slot.ends_at, p_quote_id: i.quote_id }),
  }),
  "waitlist.mark_shared": route({
    rpc: "waitlist_mark_shared", input: WaitlistOfferRefInput, output: WaitlistOffer, command: true,
    args: (i) => ({ p_offer_id: i.offer_id }),
  }),
  "waitlist.cancel_offer": route({
    rpc: "waitlist_cancel_offer", input: WaitlistOfferRefInput, output: WaitlistOffer, command: true,
    args: (i) => ({ p_offer_id: i.offer_id }),
  }),
  "waitlist.list": route({
    rpc: "waitlist_list", input: WaitlistListInput, output: WaitlistListOutput, command: false,
    args: () => ({}),
  }),
};

/** Rotas do link: anônimas, sem tenant; o token é a referência e a âncora de idempotência. */
export const WAITLIST_PUBLIC_ROUTES: Record<string, { rpc: string; output: z.ZodType; needsKey: boolean }> = {
  "waitlist.offer_view": { rpc: "waitlist_offer_view", output: WaitlistOfferView, needsKey: false },
  "waitlist.accept_offer": { rpc: "waitlist_accept_offer", output: BookingOutput, needsKey: true },
  "waitlist.decline_offer": { rpc: "waitlist_decline_offer", output: WaitlistDeclineOutput, needsKey: true },
};

const ROUTE_RE = /\/waitlist\/([a-z_.]+)\/?$/;

export function createWaitlistHandler(deps: WaitlistDeps) {
  const clock = deps.clock ?? systemClock;
  const owner = createRpcHandler("waitlist", WAITLIST_ROUTES, {
    ...deps,
    rpc: (token, fn, args) => deps.rpc(token, fn, args),
  });

  return async (req: Request): Promise<Response> => {
    const name = ROUTE_RE.exec(new URL(req.url).pathname)?.[1] ?? "";
    const spec = Object.hasOwn(WAITLIST_PUBLIC_ROUTES, name) ? WAITLIST_PUBLIC_ROUTES[name] : undefined;
    if (!spec) return owner(req);

    const started = clock.now().getTime();
    const requestId = requestIdFrom(req);
    const cors = corsHeaders(req, deps.allowedOrigins);
    const res = await handlePublic(req, spec, requestId, cors);
    // Log sem token, corpo ou tenant.
    deps.log?.({ fn: "waitlist", route: name, request_id: requestId, status: res.status, ms: clock.now().getTime() - started });
    return res;
  };

  async function handlePublic(
    req: Request,
    spec: { rpc: string; output: z.ZodType; needsKey: boolean },
    requestId: string,
    cors: Record<string, string>,
  ): Promise<Response> {
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
    // Token malformado e inexistente dão a mesma resposta.
    const input = WaitlistAcceptOfferInput.safeParse(body);
    if (!input.success) return fail("NOT_FOUND", requestId, { extra: cors });
    let result: RpcResult;
    try {
      result = await deps.rpc(null, spec.rpc, { p_token: input.data.token });
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
