// Portas do módulo Materiais (P30). Demonstração: emulação na aba, sempre rotulada; servidor: Edge Function `materials`.
import type {
  MaterialBooking,
  MaterialConsumption,
  MaterialItem,
  MaterialItemSaveInput,
  MaterialPurchase,
  MaterialServiceMargin,
  MaterialUsage,
  ProviderService,
  TimeRange,
} from "@contracts";
import type { z } from "zod";

export type ItemInput = z.input<typeof MaterialItemSaveInput>;
export type PurchaseLine = { item_id: string; quantity: number; total_cents: number };
export type { MaterialBooking, MaterialConsumption, MaterialItem, MaterialPurchase, MaterialServiceMargin, MaterialUsage, ProviderService, TimeRange };

export interface MaterialsBase {
  timezone: string;
  services: ProviderService[];
  /** Instante de referência (relógio da demonstração ou do aparelho). */
  now: string;
}
export interface MarginReport {
  services: MaterialServiceMargin[];
  totals: Omit<MaterialServiceMargin, "service_id" | "service_name" | "margin_bps">;
}

export interface MaterialsPort {
  readonly kind: "demo" | "server";
  base(): Promise<MaterialsBase>;
  list(): Promise<{ items: MaterialItem[]; usage: MaterialUsage[] }>;
  saveItem(input: ItemInput, key: string): Promise<MaterialItem>;
  saveUsage(serviceId: string, itemId: string, quantity: number | null, key: string): Promise<MaterialUsage[]>;
  purchase(supplier: string | null, purchasedAt: string, lines: PurchaseLine[], recordExpense: boolean, key: string): Promise<MaterialPurchase>;
  reversePurchase(p: MaterialPurchase, key: string): Promise<MaterialPurchase>;
  adjust(item: MaterialItem, counted: number, reason: string, key: string): Promise<MaterialItem>;
  consume(bookingId: string, lines: { item_id: string; quantity: number }[] | null, key: string): Promise<MaterialConsumption>;
  reverseConsumption(c: MaterialConsumption, key: string): Promise<MaterialConsumption>;
  purchases(period: TimeRange): Promise<MaterialPurchase[]>;
  bookings(period: TimeRange): Promise<MaterialBooking[]>;
  margin(period: TimeRange): Promise<MarginReport>;
}

export const newKey = () => crypto.randomUUID();
