// Edge Function `scheduling` (P03): disponibilidade, reservas, expediente e bloqueios.
// Cada operação é uma RPC transacional (ver _shared/http/rpc-handler.ts): o banco autoriza, trava o recurso,
// aplica idempotência/versão e grava evento e auditoria na mesma transação.
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
  ScheduleBlockCreateInput,
  ScheduleBlockOutput,
  ScheduleBlockRemoveInput,
  ScheduleDayPlansInput,
  ScheduleDayPlansOutput,
  ScheduleRulesSaveInput,
  ScheduleSettings,
  ScheduleSettingsInput,
} from "../_shared/contracts/index.ts";
import { decodeCursor, encodeCursor } from "../_shared/http/command.ts";
import { createRpcHandler, type Route, route, type RpcHandlerDeps } from "../_shared/http/rpc-handler.ts";

export type { RpcResult } from "../_shared/http/rpc-handler.ts";
export type SchedulingDeps = RpcHandlerDeps;

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

export const createSchedulingHandler = (deps: SchedulingDeps) => createRpcHandler("scheduling", SCHEDULING_ROUTES, deps);
