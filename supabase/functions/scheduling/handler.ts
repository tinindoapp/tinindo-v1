// Edge Function `scheduling` (P03): disponibilidade, reservas, expediente e bloqueios.
// Caminho de toda rota: POST /functions/v1/scheduling/<operação> → valida no contrato → chama UMA RPC
// com o JWT do usuário → o banco autoriza (app.is_member), trava o recurso, aplica idempotência/versão,
// grava evento e auditoria na mesma transação. O header X-Tinindo-Tenant é seleção; não concede acesso.
import type { z } from "zod";
import {
  AvailabilityListInput,
  AvailabilityListOutput,
  BookingCancelInput,
  BookingCompleteInput,
  BookingConfirmInput,
  BookingCreateInput,
  BookingCreateSeriesInput,
  BookingCreateSeriesOutput,
  BookingGetInput,
  BookingListInput,
  BookingListOutput,
  BookingNoShowInput,
  BookingOutput,
  BookingRescheduleInput,
  IDEMPOTENCY_HEADER,
  IdempotencyKey,
  ScheduleBlockCreateInput,
  ScheduleBlockOutput,
  ScheduleBlockRemoveInput,
  ScheduleDayPlansInput,
  ScheduleDayPlansOutput,
  ScheduleRulesSaveInput,
  ScheduleSettings,
  ScheduleSettingsInput,
  TENANT_HEADER,
} from "../_shared/contracts/index.ts";
import { canonicalJson, decodeCursor, encodeCursor, sha256Hex } from "../_shared/http/command.ts";
import { type DbErrorLike, mapDbError } from "../_shared/http/errors.ts";
import { type Clock, corsHeaders, fail, isUuid, ok, requestIdFrom, systemClock } from "../_shared/http/respond.ts";

export type RpcResult = { data: unknown; error: DbErrorLike | null };

export interface SchedulingDeps {
  /** Chama a RPC com o JWT do usuário (nunca com service role). */
  rpc(accessToken: string, fn: string, args: Record<string, unknown>): Promise<RpcResult>;
  allowedOrigins: readonly string[];
  clock?: Clock;
  log?: (entry: Record<string, unknown>) => void;
}

type Args = Record<string, unknown>;

interface Route {
  rpc: string;
  input: z.ZodType;
  output: z.ZodType;
  /** Comando: exige Idempotency-Key e devolve {status_code, body} do banco. */
  command: boolean;
  args(input: never): Args | false;
  /** Ajusta a resposta da RPC ao contrato (ex.: cursor opaco). */
  shape?(data: unknown): unknown;
}

const route = <I extends z.ZodType>(r: {
  rpc: string;
  input: I;
  output: z.ZodType;
  command: boolean;
  args(input: z.output<I>): Args | false;
  shape?(data: unknown): unknown;
}): Route => r as unknown as Route;

const slotArgs = (slot: { starts_at: string; ends_at: string }) => ({
  p_starts_at: slot.starts_at,
  p_ends_at: slot.ends_at,
});

export const SCHEDULING_ROUTES: Record<string, Route> = {
  "availability.list": route({
    rpc: "scheduling_availability", input: AvailabilityListInput, output: AvailabilityListOutput, command: false,
    args: (i) => ({
      p_resource_id: i.resource_id, p_service_id: i.service_id, p_from: i.window.starts_at, p_to: i.window.ends_at,
    }),
  }),
  "booking.create": route({
    rpc: "scheduling_booking_create", input: BookingCreateInput, output: BookingOutput, command: true,
    args: (i) => ({
      p_resource_id: i.resource_id, p_service_id: i.service_id, p_customer_id: i.customer_id,
      p_guest_ref: i.guest_ref, ...slotArgs(i.slot), p_quote_id: i.quote_id, p_mode: i.mode,
    }),
  }),
  "booking.create_series": route({
    rpc: "scheduling_booking_create_series", input: BookingCreateSeriesInput, output: BookingCreateSeriesOutput,
    command: true,
    args: (i) => ({
      p_resource_id: i.resource_id, p_service_id: i.service_id, p_customer_id: i.customer_id,
      p_guest_ref: i.guest_ref, ...slotArgs(i.slot), p_weeks: i.weeks, p_all_or_nothing: i.all_or_nothing,
    }),
  }),
  "booking.confirm": route({
    rpc: "scheduling_booking_confirm", input: BookingConfirmInput, output: BookingOutput, command: true,
    args: (i) => ({ p_booking_id: i.booking_id, p_expected_version: i.expected_version }),
  }),
  "booking.reschedule": route({
    rpc: "scheduling_booking_reschedule", input: BookingRescheduleInput, output: BookingOutput, command: true,
    args: (i) => ({
      p_booking_id: i.booking_id, p_expected_version: i.expected_version, ...slotArgs(i.slot), p_quote_id: i.quote_id,
    }),
  }),
  "booking.cancel": route({
    rpc: "scheduling_booking_cancel", input: BookingCancelInput, output: BookingOutput, command: true,
    args: (i) => ({ p_booking_id: i.booking_id, p_expected_version: i.expected_version, p_reason: i.reason }),
  }),
  "booking.complete": route({
    rpc: "scheduling_booking_complete", input: BookingCompleteInput, output: BookingOutput, command: true,
    args: (i) => ({ p_booking_id: i.booking_id, p_expected_version: i.expected_version }),
  }),
  "booking.no_show": route({
    rpc: "scheduling_booking_no_show", input: BookingNoShowInput, output: BookingOutput, command: true,
    args: (i) => ({
      p_booking_id: i.booking_id, p_expected_version: i.expected_version, p_reason: i.reason, p_revert: i.revert,
    }),
  }),
  "booking.list": route({
    rpc: "scheduling_booking_list", input: BookingListInput, output: BookingListOutput, command: false,
    args: (i) => {
      const cursor = decodeCursor(i.cursor);
      if (cursor === false) return false;
      return {
        p_from: i.window.starts_at, p_to: i.window.ends_at,
        p_after_starts: cursor?.key ?? null, p_after_id: cursor?.id ?? null, p_limit: i.limit,
      };
    },
    shape: (data) => {
      const raw = data as { items?: unknown; next?: { key: string; id: string } | null } | null;
      return { bookings: raw?.items, next_cursor: raw?.next ? encodeCursor(raw.next) : null };
    },
  }),
  "booking.get": route({
    rpc: "scheduling_booking_get", input: BookingGetInput, output: BookingOutput, command: false,
    args: (i) => ({ p_booking_id: i.booking_id }),
  }),
  "schedule.settings": route({
    rpc: "scheduling_settings", input: ScheduleSettingsInput, output: ScheduleSettings, command: false,
    args: () => ({}),
  }),
  "schedule.rules_save": route({
    rpc: "scheduling_rules_save", input: ScheduleRulesSaveInput, output: ScheduleSettings, command: true,
    args: (i) => ({ p_resource_id: i.resource_id, p_expected_version: i.expected_version, p_rules: i.rules }),
  }),
  "schedule.day_plans": route({
    rpc: "scheduling_day_plans", input: ScheduleDayPlansInput, output: ScheduleDayPlansOutput, command: false,
    args: (i) => ({ p_from: i.window.starts_at, p_to: i.window.ends_at }),
  }),
  "schedule.block_create": route({
    rpc: "scheduling_block_create", input: ScheduleBlockCreateInput, output: ScheduleBlockOutput, command: true,
    args: (i) => ({ p_resource_id: i.resource_id, ...slotArgs(i.range), p_label: i.label }),
  }),
  "schedule.block_remove": route({
    rpc: "scheduling_block_remove", input: ScheduleBlockRemoveInput, output: ScheduleBlockOutput, command: true,
    args: (i) => ({ p_block_id: i.block_id, p_expected_version: i.expected_version }),
  }),
};

const ROUTE_RE = /\/scheduling\/([a-z_.]+)\/?$/;
const MAX_BODY_BYTES = 64 * 1024;

export function createSchedulingHandler(deps: SchedulingDeps) {
  const clock = deps.clock ?? systemClock;

  return async (req: Request): Promise<Response> => {
    const started = clock.now().getTime();
    const requestId = requestIdFrom(req);
    const cors = corsHeaders(req, deps.allowedOrigins);
    const name = ROUTE_RE.exec(new URL(req.url).pathname)?.[1] ?? "";
    const res = await handle(req, name, requestId, cors);
    // Log técnico sem PII: sem tenant, token ou corpo.
    deps.log?.({ fn: "scheduling", route: name, request_id: requestId, status: res.status, ms: clock.now().getTime() - started });
    return res;
  };

  async function handle(req: Request, name: string, requestId: string, cors: Record<string, string>) {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    const spec = Object.hasOwn(SCHEDULING_ROUTES, name) ? SCHEDULING_ROUTES[name] : undefined;
    if (!spec) return fail("NOT_FOUND", requestId, { extra: cors });
    if (req.method !== "POST") return fail("VALIDATION_ERROR", requestId, { message: "Use POST.", extra: cors });

    const auth = req.headers.get("Authorization") ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    if (!token) return fail("AUTH_REQUIRED", requestId, { extra: cors });
    const tenantId = req.headers.get(TENANT_HEADER);
    if (!isUuid(tenantId)) {
      return fail("VALIDATION_ERROR", requestId, { field: "tenant_id", message: "Selecione um negócio.", extra: cors });
    }

    let key: string | null = null;
    if (spec.command) {
      const parsedKey = IdempotencyKey.safeParse(req.headers.get(IDEMPOTENCY_HEADER));
      if (!parsedKey.success) {
        return fail("VALIDATION_ERROR", requestId, {
          field: "idempotency_key", message: "Envie o header Idempotency-Key.", extra: cors,
        });
      }
      key = parsedKey.data;
    }

    const text = await req.text().catch(() => "");
    if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
      return fail("VALIDATION_ERROR", requestId, { message: "Corpo grande demais.", extra: cors });
    }
    let json: unknown;
    try {
      json = text.trim() === "" ? {} : JSON.parse(text);
    } catch {
      return fail("VALIDATION_ERROR", requestId, { message: "JSON inválido.", extra: cors });
    }
    const input = spec.input.safeParse(json);
    if (!input.success) {
      const path = input.error.issues[0]?.path.map(String).join(".");
      return fail("VALIDATION_ERROR", requestId, { field: path || undefined, extra: cors });
    }
    const args = spec.args(input.data as never);
    if (args === false) return fail("VALIDATION_ERROR", requestId, { field: "cursor", extra: cors });

    const rpcArgs: Args = { p_tenant_id: tenantId, ...args };
    if (spec.command) {
      Object.assign(rpcArgs, {
        p_idem_key: key,
        // O hash cobre a operação e a entrada normalizada (com defaults), nunca a chave.
        p_request_hash: await sha256Hex(canonicalJson({ operation: name, input: input.data })),
        p_request_id: requestId,
      });
    }

    let result: RpcResult;
    try {
      result = await deps.rpc(token, spec.rpc, rpcArgs);
    } catch {
      return fail("PROVIDER_UNAVAILABLE", requestId, { extra: cors });
    }
    if (result.error) {
      const mapped = mapDbError(result.error);
      return fail(mapped.code, requestId, { field: mapped.field, extra: cors });
    }

    let status = 200;
    let body: unknown = result.data;
    if (spec.command) {
      const envelope = result.data as { status_code?: unknown; body?: unknown } | null;
      status = typeof envelope?.status_code === "number" ? envelope.status_code : 0;
      if (status < 200 || status > 299) return fail("INTERNAL_ERROR", requestId, { extra: cors });
      body = envelope?.body;
    }
    if (spec.shape) body = spec.shape(body);
    const parsed = spec.output.safeParse(body);
    if (!parsed.success) return fail("INTERNAL_ERROR", requestId, { extra: cors });
    return ok(parsed.data, requestId, clock, status, cors);
  }
}
