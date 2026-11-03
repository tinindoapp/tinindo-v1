// Portas reais do Domicílio: Edge Function `field-service`.
import {
  FieldRebuildOutput,
  FieldRouteOutput,
  FieldSettingsGetOutput,
  FieldSettingsOutput,
  FieldTravelOutput,
  FieldVisitDetachOutput,
  FieldVisitOutput,
  FieldZoneForOutput,
  FieldZoneOutput,
} from "@contracts";
import type { createApiClient } from "../../lib/api/client.ts";
import type { FieldPort } from "./port.ts";

type Call = ReturnType<typeof createApiClient>;
const op = (name: string) => `/field-service/${name}`;

/** Dia de hoje no fuso informado (o do negócio). */
const todayIn = (timeZone: string) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

export function createServerPort(call: Call, tenantId: string): FieldPort {
  const post = (body: unknown, idempotencyKey?: string) => ({ method: "POST" as const, tenantId, body, idempotencyKey });
  let tz = "America/Sao_Paulo";
  return {
    kind: "server",
    today: () => todayIn(tz),
    async config() {
      const { data } = await call(op("field.settings"), FieldSettingsGetOutput, post({}));
      tz = data.timezone;
      return data;
    },
    async saveSettings(input, key) {
      return (await call(op("field.settings_save"), FieldSettingsOutput, post(input, key))).data.settings;
    },
    async saveZone(input, key) {
      return (await call(op("field.zone_save"), FieldZoneOutput, post(input, key))).data.zone;
    },
    async saveTravel(zone_a, zone_b, minutes, key) {
      return (await call(op("field.travel_save"), FieldTravelOutput, post({ zone_a, zone_b, minutes }, key))).data.travel_times;
    },
    async zoneFor(cep) {
      return (await call(op("field.zone_for"), FieldZoneForOutput, post({ cep }))).data;
    },
    async route(day) {
      return (await call(op("field.route"), FieldRouteOutput, post({ day }))).data;
    },
    async attach(booking_id, zone_id, cep5, key) {
      return (await call(op("field.visit_attach"), FieldVisitOutput, post({ booking_id, zone_id, cep5 }, key))).data.stop;
    },
    async detach(booking_id, key) {
      await call(op("field.visit_detach"), FieldVisitDetachOutput, post({ booking_id }, key));
    },
    async rebuild(day, key) {
      return (await call(op("field.route_rebuild"), FieldRebuildOutput, post({ day }, key))).data.stops;
    },
  };
}
