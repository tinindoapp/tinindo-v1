// Edge Function `field-service` (P29): atendimento a domicílio. Cada operação é uma RPC transacional do dono
// (ver _shared/http/rpc-handler.ts). Deslocamento e roteiro são montados no banco, sob o lock da agenda.
import {
  FieldDayInput,
  FieldRebuildOutput,
  FieldRouteOutput,
  FieldSettingsGetInput,
  FieldSettingsGetOutput,
  FieldSettingsOutput,
  FieldSettingsSaveInput,
  FieldTravelOutput,
  FieldTravelSaveInput,
  FieldVisitAttachInput,
  FieldVisitDetachInput,
  FieldVisitDetachOutput,
  FieldVisitOutput,
  FieldZoneForInput,
  FieldZoneForOutput,
  FieldZoneOutput,
  FieldZoneSaveInput,
} from "../_shared/contracts/index.ts";
import { createRpcHandler, type Route, route, type RpcHandlerDeps } from "../_shared/http/rpc-handler.ts";

export type FieldServiceDeps = RpcHandlerDeps;

export const FIELD_SERVICE_ROUTES: Record<string, Route> = {
  "field.settings": route({ rpc: "field_settings_get", input: FieldSettingsGetInput, output: FieldSettingsGetOutput, command: false, args: () => ({}) }),
  "field.settings_save": route({
    rpc: "field_settings_save", input: FieldSettingsSaveInput, output: FieldSettingsOutput, command: true,
    args: (i) => ({ p_expected_version: i.expected_version, p_enabled: i.enabled, p_default_travel_min: i.default_travel_min,
      p_same_zone_travel_min: i.same_zone_travel_min, p_arrival_window_min: i.arrival_window_min, p_max_km: i.max_km }),
  }),
  "field.zone_save": route({
    rpc: "field_zone_save", input: FieldZoneSaveInput, output: FieldZoneOutput, command: true,
    args: (i) => ({ p_zone_id: i.zone_id, p_expected_version: i.expected_version, p_name: i.name, p_cep_prefixes: i.cep_prefixes,
      p_distance_km: i.distance_km, p_travel_from_base_min: i.travel_from_base_min, p_active: i.active }),
  }),
  "field.travel_save": route({
    rpc: "field_travel_save", input: FieldTravelSaveInput, output: FieldTravelOutput, command: true,
    args: (i) => ({ p_zone_a: i.zone_a, p_zone_b: i.zone_b, p_minutes: i.minutes }),
  }),
  "field.zone_for": route({ rpc: "field_zone_for", input: FieldZoneForInput, output: FieldZoneForOutput, command: false, args: (i) => ({ p_cep: i.cep }) }),
  "field.visit_attach": route({
    rpc: "field_visit_attach", input: FieldVisitAttachInput, output: FieldVisitOutput, command: true,
    args: (i) => ({ p_booking_id: i.booking_id, p_zone_id: i.zone_id, p_cep5: i.cep5 }),
  }),
  "field.visit_detach": route({
    rpc: "field_visit_detach", input: FieldVisitDetachInput, output: FieldVisitDetachOutput, command: true,
    args: (i) => ({ p_booking_id: i.booking_id }),
  }),
  "field.route_rebuild": route({ rpc: "field_route_rebuild", input: FieldDayInput, output: FieldRebuildOutput, command: true, args: (i) => ({ p_day: i.day }) }),
  "field.route": route({ rpc: "field_route", input: FieldDayInput, output: FieldRouteOutput, command: false, args: (i) => ({ p_day: i.day }) }),
};

export function createFieldServiceHandler(deps: FieldServiceDeps) {
  return createRpcHandler("field-service", FIELD_SERVICE_ROUTES, deps);
}
