// Edge Function `resources` (P28): equipe e recursos do negócio. Cada operação é uma RPC transacional do dono
// (ver _shared/http/rpc-handler.ts). A reserva composta é tudo ou nada no banco; aqui só validação e transporte.
import {
  TeamAvailabilityInput,
  TeamAvailabilityOutput,
  TeamBookingCancelInput,
  TeamBookingCompleteInput,
  TeamBookingCreateInput,
  TeamBookingOutput,
  TeamClassCancelInput,
  TeamClassCompleteInput,
  TeamClassCreateInput,
  TeamClassEnrollInput,
  TeamClassOutput,
  TeamCommissionEntryOutput,
  TeamCommissionReverseInput,
  TeamCommissionRuleSaveInput,
  TeamCommissionRulesOutput,
  TeamCommissionsInput,
  TeamCommissionsOutput,
  TeamListInput,
  TeamListOutput,
  TeamResourceOutput,
  TeamResourceSaveInput,
  TeamScheduleInput,
  TeamScheduleOutput,
  TeamSeatCancelInput,
} from "../_shared/contracts/index.ts";
import { createRpcHandler, type Route, route, type RpcHandlerDeps } from "../_shared/http/rpc-handler.ts";

export type ResourcesDeps = RpcHandlerDeps;

export const RESOURCES_ROUTES: Record<string, Route> = {
  "resources.list": route({ rpc: "resources_list", input: TeamListInput, output: TeamListOutput, command: false, args: () => ({}) }),
  "resources.save": route({
    rpc: "resources_save", input: TeamResourceSaveInput, output: TeamResourceOutput, command: true,
    args: (i) => ({ p_resource_id: i.resource_id, p_expected_version: i.expected_version, p_kind: i.kind, p_name: i.name, p_active: i.active,
      p_commission_bps: i.commission_bps, p_agenda_linked: i.agenda_linked }),
  }),
  "resources.commission_rule_save": route({
    rpc: "resources_commission_rule_save", input: TeamCommissionRuleSaveInput, output: TeamCommissionRulesOutput, command: true,
    args: (i) => ({ p_professional_id: i.professional_id, p_service_id: i.service_id, p_bps: i.bps }),
  }),
  "resources.availability": route({
    rpc: "resources_availability", input: TeamAvailabilityInput, output: TeamAvailabilityOutput, command: false,
    args: (i) => ({ p_service_id: i.service_id, p_professional_id: i.professional_id, p_resource_ids: i.resource_ids, p_from: i.window.starts_at, p_to: i.window.ends_at }),
  }),
  "resources.booking_create": route({
    rpc: "resources_booking_create", input: TeamBookingCreateInput, output: TeamBookingOutput, command: true,
    args: (i) => ({ p_service_id: i.service_id, p_customer_id: i.customer_id, p_professional_id: i.professional_id, p_resource_ids: i.resource_ids, p_starts_at: i.starts_at }),
  }),
  "resources.booking_cancel": route({
    rpc: "resources_booking_cancel", input: TeamBookingCancelInput, output: TeamBookingOutput, command: true,
    args: (i) => ({ p_booking_id: i.booking_id, p_expected_version: i.expected_version, p_reason: i.reason }),
  }),
  "resources.booking_complete": route({
    rpc: "resources_booking_complete", input: TeamBookingCompleteInput, output: TeamBookingOutput, command: true,
    args: (i) => ({ p_booking_id: i.booking_id, p_expected_version: i.expected_version }),
  }),
  "resources.schedule": route({
    rpc: "resources_schedule", input: TeamScheduleInput, output: TeamScheduleOutput, command: false,
    args: (i) => ({ p_from: i.window.starts_at, p_to: i.window.ends_at }),
  }),
  "resources.class_create": route({
    rpc: "resources_class_create", input: TeamClassCreateInput, output: TeamClassOutput, command: true,
    args: (i) => ({ p_service_id: i.service_id, p_professional_id: i.professional_id, p_room_id: i.room_id, p_title: i.title, p_starts_at: i.starts_at,
      p_capacity: i.capacity, p_seat_price_cents: i.seat_price_cents }),
  }),
  "resources.class_enroll": route({
    rpc: "resources_class_enroll", input: TeamClassEnrollInput, output: TeamClassOutput, command: true,
    args: (i) => ({ p_class_id: i.class_id, p_customer_id: i.customer_id }),
  }),
  "resources.class_seat_cancel": route({
    rpc: "resources_class_seat_cancel", input: TeamSeatCancelInput, output: TeamClassOutput, command: true,
    args: (i) => ({ p_seat_id: i.seat_id, p_expected_version: i.expected_version }),
  }),
  "resources.class_cancel": route({
    rpc: "resources_class_cancel", input: TeamClassCancelInput, output: TeamClassOutput, command: true,
    args: (i) => ({ p_class_id: i.class_id, p_expected_version: i.expected_version }),
  }),
  "resources.class_complete": route({
    rpc: "resources_class_complete", input: TeamClassCompleteInput, output: TeamClassOutput, command: true,
    args: (i) => ({ p_class_id: i.class_id, p_expected_version: i.expected_version, p_attended_seat_ids: i.attended_seat_ids }),
  }),
  "resources.commission_reverse": route({
    rpc: "resources_commission_reverse", input: TeamCommissionReverseInput, output: TeamCommissionEntryOutput, command: true,
    args: (i) => ({ p_entry_id: i.entry_id }),
  }),
  "resources.commissions": route({
    rpc: "resources_commissions", input: TeamCommissionsInput, output: TeamCommissionsOutput, command: false,
    args: (i) => ({ p_from: i.period.starts_at, p_to: i.period.ends_at }),
  }),
};

export function createResourcesHandler(deps: ResourcesDeps) {
  return createRpcHandler("resources", RESOURCES_ROUTES, deps);
}
