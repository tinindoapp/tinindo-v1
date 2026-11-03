// Serviço a domicílio (P29). Aditivos ao v1; ver ADR-0034.
// Área por zona (bairro + prefixos de CEP de 5 dígitos) e distância declarada; deslocamento entre atendimentos vira
// bloqueio da agenda (P03); janela de chegada para o cliente; roteiro do dia em ordem. Localização com finalidade e
// precisão limitadas: nunca endereço, coordenada ou rastreamento. Fora daqui: contratação pelo marketplace (P25).
import { z } from "zod";
import { IsoDateTime, LocalDate, TimeZone, Uuid } from "./common.ts";

export const Cep5 = z.string().regex(/^\d{5}$/, "5 dígitos");
export const FieldSettings = z.object({
  enabled: z.boolean(),
  default_travel_min: z.int().min(0).max(240),
  same_zone_travel_min: z.int().min(0).max(120),
  arrival_window_min: z.int().min(0).max(120),
  max_km: z.number().positive().max(200).nullable(),
  version: z.int().min(1),
});
export type FieldSettings = z.infer<typeof FieldSettings>;
export const FieldZone = z.object({
  id: Uuid,
  name: z.string().min(1).max(60),
  cep_prefixes: z.array(Cep5).max(50),
  distance_km: z.number().min(0).max(200),
  travel_from_base_min: z.int().min(0).max(240),
  active: z.boolean(),
  /** Ativa e dentro da distância máxima. */
  in_area: z.boolean(),
  version: z.int().min(1),
});
export type FieldZone = z.infer<typeof FieldZone>;
export const FieldTravelTime = z.object({ zone_a: Uuid, zone_b: Uuid, minutes: z.int().min(0).max(240) });
export type FieldTravelTime = z.infer<typeof FieldTravelTime>;

export const FieldSettingsGetInput = z.object({});
export const FieldSettingsGetOutput = z.object({
  settings: FieldSettings,
  zones: z.array(FieldZone).max(200),
  travel_times: z.array(FieldTravelTime).max(2000),
  timezone: TimeZone,
});
export const FieldSettingsSaveInput = z.object({
  /** null na primeira vez (as regras ainda são as padrão). */
  expected_version: z.int().min(1).nullable().default(null),
  enabled: z.boolean().default(true),
  default_travel_min: z.int().min(0).max(240),
  same_zone_travel_min: z.int().min(0).max(120),
  arrival_window_min: z.int().min(0).max(120),
  max_km: z.number().positive().max(200).nullable().default(null),
});
export const FieldSettingsOutput = z.object({ settings: FieldSettings });

export const FieldZoneSaveInput = z.object({
  zone_id: Uuid.nullable().default(null),
  expected_version: z.int().min(1).nullable().default(null),
  name: z.string().trim().min(1).max(60),
  cep_prefixes: z.array(Cep5).max(50).refine((a) => new Set(a).size === a.length, { message: "CEP repetido" }).default([]),
  distance_km: z.number().min(0).max(200),
  travel_from_base_min: z.int().min(0).max(240),
  active: z.boolean().default(true),
});
export const FieldZoneOutput = z.object({ zone: FieldZone });
export const FieldTravelSaveInput = z.object({
  zone_a: Uuid,
  zone_b: Uuid,
  /** null tira o tempo cadastrado (volta o padrão). */
  minutes: z.int().min(0).max(240).nullable(),
}).refine((v) => v.zone_a !== v.zone_b, { message: "zonas iguais", path: ["zone_b"] });
export const FieldTravelOutput = z.object({ travel_times: z.array(FieldTravelTime).max(2000) });

export const FieldZoneForInput = z.object({ cep: z.string().trim().min(5).max(9) });
export const FieldZoneForOutput = z.object({ cep5: Cep5, zone: FieldZone.nullable(), in_area: z.boolean() });

export const FieldStop = z.object({
  visit_id: Uuid,
  booking_id: Uuid,
  status: z.enum(["held", "confirmed", "completed", "cancelled", "expired", "no_show"]),
  zone_id: Uuid,
  zone_name: z.string(),
  cep5: Cep5.nullable(),
  customer_name: z.string().nullable(),
  service_name: z.string().nullable(),
  /** Minutos de deslocamento até esta visita (null = recalcular o roteiro). */
  travel_min: z.int().min(0).max(240).nullable(),
  /** Saída para esta visita (início do bloqueio de deslocamento). */
  depart_at: IsoDateTime.nullable(),
  /** Janela de chegada mostrada ao cliente. */
  arrival_from: IsoDateTime,
  arrival_to: IsoDateTime,
  starts_at: IsoDateTime,
  ends_at: IsoDateTime,
  version: z.int().min(1),
});
export type FieldStop = z.infer<typeof FieldStop>;
export const FieldVisitAttachInput = z.object({ booking_id: Uuid, zone_id: Uuid, cep5: Cep5.nullable().default(null) });
export const FieldVisitOutput = z.object({ stop: FieldStop });
export const FieldVisitDetachInput = z.object({ booking_id: Uuid });
export const FieldVisitDetachOutput = z.object({ booking_id: Uuid, detached: z.literal(true) });
export const FieldDayInput = z.object({ day: LocalDate });
export const FieldRebuildOutput = z.object({ day: LocalDate, stops: z.int().min(0) });
export const FieldRouteOutput = z.object({
  day: LocalDate,
  timezone: TimeZone,
  arrival_window_min: z.int().min(0).max(120),
  stops: z.array(FieldStop).max(100),
  /** Algum atendimento mudou na agenda e o deslocamento precisa ser recalculado. */
  needs_rebuild: z.boolean(),
  /** Atendimentos do dia (para marcar como domicílio). */
  bookings: z.array(z.object({ booking_id: Uuid, starts_at: IsoDateTime, customer_name: z.string().nullable(), service_name: z.string().nullable(), is_visit: z.boolean() })).max(200),
});
export type FieldRoute = z.infer<typeof FieldRouteOutput>;
