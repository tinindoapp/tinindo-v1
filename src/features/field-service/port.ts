// Portas do módulo Domicílio (P29). Demonstração: emulação na aba, sempre rotulada; servidor: Edge Function `field-service`.
import type { FieldRoute, FieldSettings, FieldSettingsSaveInput, FieldStop, FieldTravelTime, FieldZone, FieldZoneSaveInput } from "@contracts";
import type { z } from "zod";

export type SettingsInput = z.input<typeof FieldSettingsSaveInput>;
export type ZoneInput = z.input<typeof FieldZoneSaveInput>;
export type { FieldRoute, FieldSettings, FieldStop, FieldTravelTime, FieldZone };
export interface FieldConfig { settings: FieldSettings; zones: FieldZone[]; travel_times: FieldTravelTime[]; timezone: string }

export interface FieldPort {
  readonly kind: "demo" | "server";
  /** Dia de hoje no fuso do negócio (relógio da demonstração ou do aparelho). */
  today(): string;
  config(): Promise<FieldConfig>;
  saveSettings(input: SettingsInput, key: string): Promise<FieldSettings>;
  saveZone(input: ZoneInput, key: string): Promise<FieldZone>;
  saveTravel(zoneA: string, zoneB: string, minutes: number | null, key: string): Promise<FieldTravelTime[]>;
  zoneFor(cep: string): Promise<{ cep5: string; zone: FieldZone | null; in_area: boolean }>;
  route(day: string): Promise<FieldRoute>;
  attach(bookingId: string, zoneId: string, cep5: string | null, key: string): Promise<FieldStop>;
  detach(bookingId: string, key: string): Promise<void>;
  rebuild(day: string, key: string): Promise<number>;
}

export const newKey = () => crypto.randomUUID();
