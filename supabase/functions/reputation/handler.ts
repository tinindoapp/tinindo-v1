// Edge Function `reputation` (P24). Dono pelo rpc-handler (lista e resposta). Cliente com login, sem negócio
// selecionado (não é membro): pendentes, enviar, retirar e denunciar; os comandos exigem Idempotency-Key e o banco
// garante a idempotência natural (uma avaliação por atendimento, uma denúncia aberta por pessoa). Público: lista do
// perfil publicado (anon). O autor nunca sai em nenhuma resposta.
import type { z } from "zod";
import {
  IdempotencyKey, MyReviewOutput, ReviewOwnerListInput, ReviewOwnerListOutput, ReviewPendingInput, ReviewPendingOutput, ReviewPublicListInput, ReviewPublicListOutput,
  ReviewReplyInput, ReviewReplyOutput, ReviewReportInput, ReviewReportOutput, ReviewSubmitInput, ReviewWithdrawInput, IDEMPOTENCY_HEADER,
} from "../_shared/contracts/index.ts";
import { mapDbError } from "../_shared/http/errors.ts";
import { corsHeaders, fail, ok, requestIdFrom, systemClock } from "../_shared/http/respond.ts";
import { createRpcHandler, type Route, route, type RpcHandlerDeps, type RpcResult } from "../_shared/http/rpc-handler.ts";

export interface ReputationDeps extends RpcHandlerDeps {
  anonRpc(fn: string, args: Record<string, unknown>): Promise<RpcResult>;
}

export const REPUTATION_OWNER_ROUTES: Record<string, Route> = {
  "review.owner_list": route({ rpc: "review_owner_list", input: ReviewOwnerListInput, output: ReviewOwnerListOutput, command: false, args: () => ({}) }),
  "review.reply": route({
    rpc: "review_reply", input: ReviewReplyInput, output: ReviewReplyOutput, command: true,
    args: (i) => ({ p_review_id: i.review_id, p_expected_version: i.expected_version, p_body: i.body }),
  }),
};

interface UserRoute { rpc: string; input: z.ZodType; output: z.ZodType; command: boolean; args(i: never): Record<string, unknown> }
const userRoute = <I extends z.ZodType>(r: { rpc: string; input: I; output: z.ZodType; command: boolean; args(i: z.output<I>): Record<string, unknown> }) => r as unknown as UserRoute;
/** Rotas do cliente com login (sem negócio). */
export const REPUTATION_USER_ROUTES: Record<string, UserRoute> = {
  "review.pending": userRoute({ rpc: "review_pending", input: ReviewPendingInput, output: ReviewPendingOutput, command: false, args: () => ({}) }),
  "review.submit": userRoute({ rpc: "review_submit", input: ReviewSubmitInput, output: MyReviewOutput, command: true, args: (i) => ({ p_booking_id: i.booking_id, p_rating: i.rating, p_body: i.body }) }),
  "review.withdraw": userRoute({ rpc: "review_withdraw", input: ReviewWithdrawInput, output: MyReviewOutput, command: true, args: (i) => ({ p_review_id: i.review_id }) }),
  "review.report": userRoute({ rpc: "review_report", input: ReviewReportInput, output: ReviewReportOutput, command: true, args: (i) => ({ p_review_id: i.review_id, p_reason: i.reason, p_note: i.note }) }),
};
export const REPUTATION_PUBLIC = { "review.public_list": { rpc: "review_public_list", input: ReviewPublicListInput, output: ReviewPublicListOutput } } as const;
const ROUTE_RE = /\/reputation\/([a-z_.]+)\/?$/;

export function createReputationHandler(deps: ReputationDeps) {
  const clock = deps.clock ?? systemClock;
  const owner = createRpcHandler("reputation", REPUTATION_OWNER_ROUTES, deps);

  return async (req: Request): Promise<Response> => {
    const name = ROUTE_RE.exec(new URL(req.url).pathname)?.[1] ?? "";
    const started = clock.now().getTime();
    const requestId = requestIdFrom(req);
    const cors = corsHeaders(req, deps.allowedOrigins);
    let res: Response;
    if (Object.hasOwn(REPUTATION_USER_ROUTES, name)) res = await user(name, req, requestId, cors);
    else if (name === "review.public_list") res = await publicList(req, requestId, cors);
    else return owner(req);
    deps.log?.({ fn: "reputation", route: name, request_id: requestId, status: res.status, ms: clock.now().getTime() - started });
    return res;
  };

  async function user(name: string, req: Request, requestId: string, cors: Record<string, string>): Promise<Response> {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (req.method !== "POST") return fail("VALIDATION_ERROR", requestId, { message: "Use POST.", extra: cors });
    const spec = REPUTATION_USER_ROUTES[name]!;
    const auth = req.headers.get("Authorization") ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    if (!token) return fail("AUTH_REQUIRED", requestId, { extra: cors });
    if (spec.command && !IdempotencyKey.safeParse(req.headers.get(IDEMPOTENCY_HEADER)).success) {
      return fail("VALIDATION_ERROR", requestId, { field: "idempotency_key", message: "Envie o header Idempotency-Key.", extra: cors });
    }
    const input = spec.input.safeParse(await req.json().catch(() => ({})));
    if (!input.success) return fail("VALIDATION_ERROR", requestId, { field: input.error.issues[0]?.path.map(String).join(".") || undefined, extra: cors });
    let r: RpcResult;
    try {
      r = await deps.rpc(token, spec.rpc, spec.args(input.data as never));
    } catch {
      return fail("PROVIDER_UNAVAILABLE", requestId, { extra: cors });
    }
    if (r.error) {
      const m = mapDbError(r.error);
      return fail(m.code, requestId, { field: m.field, extra: cors });
    }
    const out = spec.output.safeParse(r.data);
    if (!out.success) return fail("INTERNAL_ERROR", requestId, { extra: cors });
    return ok(out.data, requestId, clock, spec.command ? 201 : 200, cors);
  }

  async function publicList(req: Request, requestId: string, cors: Record<string, string>): Promise<Response> {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (req.method !== "POST") return fail("VALIDATION_ERROR", requestId, { message: "Use POST.", extra: cors });
    const input = ReviewPublicListInput.safeParse(await req.json().catch(() => null));
    if (!input.success) return fail("VALIDATION_ERROR", requestId, { field: "slug", extra: cors });
    const r = await deps.anonRpc("review_public_list", { p_slug: input.data.slug }).catch(() => null);
    if (!r) return fail("PROVIDER_UNAVAILABLE", requestId, { extra: cors });
    if (r.error) return fail(mapDbError(r.error).code, requestId, { extra: cors });
    const out = ReviewPublicListOutput.safeParse(r.data);
    if (!out.success) return fail("INTERNAL_ERROR", requestId, { extra: cors });
    return ok(out.data, requestId, clock, 200, cors);
  }
}
