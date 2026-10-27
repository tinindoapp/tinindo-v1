// Materiais e custos (P30). Aditivos ao v1; ver ADR-0032.
// Estoque em razão append-only com custo médio; compra (despesa opcional no Caixa, P07); ficha de uso por serviço;
// consumo por atendimento concluído, um ativo por atendimento, tudo ou nada; estorno uma vez; margem real com cobertura;
// custo estimado do orçamento (P11). Quantidades com até 3 casas; dinheiro em centavos inteiros.
import { z } from "zod";
import { Cents, IsoDateTime, SignedCents, TimeRange, TimeZone, Uuid } from "./common.ts";

/** Quantidade positiva com até 3 casas decimais. */
export const MaterialQty = z.number().positive().max(999_999).refine((n) => Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-6, {
  message: "até 3 casas decimais",
});
export const MaterialUnit = z.enum(["un", "ml", "g"]);
export const MaterialKind = z.enum(["consumable", "product"]);

export const MaterialItem = z.object({
  id: Uuid,
  name: z.string().min(1).max(80),
  kind: MaterialKind,
  unit: MaterialUnit,
  active: z.boolean(),
  on_hand: z.number().min(0),
  stock_value_cents: Cents,
  /** Custo médio por unidade, arredondado (null sem estoque). */
  unit_cost_cents: Cents.nullable(),
  min_qty: z.number().min(0).nullable(),
  low_stock: z.boolean(),
  version: z.int().min(1),
});
export type MaterialItem = z.infer<typeof MaterialItem>;
export const MaterialUsage = z.object({ service_id: Uuid, item_id: Uuid, quantity: z.number().positive() });
export type MaterialUsage = z.infer<typeof MaterialUsage>;

export const MaterialListInput = z.object({});
export const MaterialListOutput = z.object({ items: z.array(MaterialItem).max(1000), usage: z.array(MaterialUsage).max(5000), timezone: TimeZone });

export const MaterialItemSaveInput = z.object({
  item_id: Uuid.nullable().default(null),
  expected_version: z.int().min(1).nullable().default(null),
  name: z.string().trim().min(1).max(80),
  kind: MaterialKind.default("consumable"),
  unit: MaterialUnit,
  active: z.boolean().default(true),
  min_qty: z.number().min(0).max(999_999).nullable().default(null),
});
export const MaterialItemOutput = z.object({ item: MaterialItem });

export const MaterialUsageSaveInput = z.object({
  service_id: Uuid,
  item_id: Uuid,
  /** null remove o item da ficha do serviço. */
  quantity: MaterialQty.nullable(),
});
export const MaterialUsageOutput = z.object({ usage: z.array(MaterialUsage).max(5000) });

const distinctItems = <T extends { item_id: string }>(a: T[]) => new Set(a.map((x) => x.item_id)).size === a.length;
export const MaterialPurchaseLineInput = z.object({ item_id: Uuid, quantity: MaterialQty, total_cents: Cents });
export const MaterialPurchaseInput = z.object({
  supplier: z.string().trim().max(80).nullable().default(null),
  purchased_at: IsoDateTime,
  lines: z.array(MaterialPurchaseLineInput).min(1).max(30).refine(distinctItems, { message: "item repetido" }),
  /** true = registra a despesa (categoria materiais) no Caixa na mesma transação. */
  record_expense: z.boolean().default(true),
});
export const MaterialPurchase = z.object({
  id: Uuid,
  supplier: z.string().nullable(),
  purchased_at: IsoDateTime,
  total_cents: Cents,
  expense_id: Uuid.nullable(),
  status: z.enum(["recorded", "reversed"]),
  lines: z.array(z.object({ item_id: Uuid, item_name: z.string(), unit: MaterialUnit, quantity: z.number(), total_cents: Cents })).max(30),
  version: z.int().min(1),
});
export type MaterialPurchase = z.infer<typeof MaterialPurchase>;
export const MaterialPurchaseOutput = z.object({ purchase: MaterialPurchase });
export const MaterialPurchaseReverseInput = z.object({ purchase_id: Uuid, expected_version: z.int().min(1) });

export const MaterialAdjustInput = z.object({
  item_id: Uuid,
  expected_version: z.int().min(1),
  /** Quantidade contada; a diferença entra ou sai pelo custo médio. */
  counted: z.number().min(0).max(999_999),
  reason: z.string().trim().min(1).max(140),
});

export const MaterialConsumption = z.object({
  id: Uuid,
  booking_id: Uuid,
  status: z.enum(["active", "reversed"]),
  cost_cents: Cents,
  source: z.enum(["usage", "manual"]),
  lines: z.array(z.object({ item_id: Uuid, item_name: z.string(), unit: MaterialUnit, quantity: z.number(), cost_cents: Cents })).max(30),
  created_at: IsoDateTime,
  version: z.int().min(1),
});
export type MaterialConsumption = z.infer<typeof MaterialConsumption>;
export const MaterialConsumeInput = z.object({
  booking_id: Uuid,
  /** null = pela ficha do serviço; ou as quantidades usadas de fato. */
  lines: z.array(z.object({ item_id: Uuid, quantity: MaterialQty })).min(1).max(30).refine(distinctItems, { message: "item repetido" }).nullable().default(null),
});
export const MaterialConsumptionOutput = z.object({ consumption: MaterialConsumption });
export const MaterialConsumeReverseInput = z.object({ consumption_id: Uuid, expected_version: z.int().min(1) });

export const MaterialMovement = z.object({
  id: Uuid,
  item_id: Uuid,
  item_name: z.string(),
  kind: z.enum(["purchase", "consumption", "adjustment", "reversal"]),
  quantity: z.number(),
  value_cents: SignedCents,
  purchase_id: Uuid.nullable(),
  consumption_id: Uuid.nullable(),
  booking_id: Uuid.nullable(),
  reversal_of: Uuid.nullable(),
  reversed: z.boolean(),
  created_at: IsoDateTime,
});
export type MaterialMovement = z.infer<typeof MaterialMovement>;
export const MaterialMovementsInput = z.object({ item_id: Uuid.nullable().default(null), period: TimeRange });
export const MaterialMovementsOutput = z.object({ movements: z.array(MaterialMovement).max(200), purchases: z.array(MaterialPurchase).max(100) });

export const MaterialBooking = z.object({
  booking_id: Uuid,
  starts_at: IsoDateTime,
  service_id: Uuid,
  service_name: z.string(),
  customer_name: z.string().nullable(),
  agreed_price_cents: Cents.nullable(),
  has_usage: z.boolean(),
  consumption: MaterialConsumption.nullable(),
});
export type MaterialBooking = z.infer<typeof MaterialBooking>;
export const MaterialBookingsInput = z.object({ period: TimeRange });
export const MaterialBookingsOutput = z.object({ bookings: z.array(MaterialBooking).max(200) });

const MarginFigures = {
  completed: z.int().min(0),
  /** Atendimentos com consumo registrado: só nesses a margem é real. */
  with_materials: z.int().min(0),
  revenue_cents: Cents,
  covered_revenue_cents: Cents,
  material_cost_cents: Cents,
  margin_cents: SignedCents,
};
export const MaterialServiceMargin = z.object({ service_id: Uuid, service_name: z.string(), ...MarginFigures, margin_bps: z.int().min(-10_000_000).max(10_000).nullable() });
export type MaterialServiceMargin = z.infer<typeof MaterialServiceMargin>;
export const MaterialMarginInput = z.object({ period: TimeRange });
export const MaterialMarginOutput = z.object({ services: z.array(MaterialServiceMargin).max(500), totals: z.object(MarginFigures), period: TimeRange });

export const MaterialQuoteCostInput = z.object({ quote_id: Uuid });
export const MaterialQuoteCostOutput = z.object({
  quote_id: Uuid,
  version_no: z.int().min(1),
  total_cents: Cents,
  lines: z.array(z.object({
    line: z.int().min(0),
    service_id: Uuid.nullable(),
    description: z.string().nullable(),
    quantity: z.number(),
    line_total_cents: Cents,
    material_cost_cents: Cents,
    /** Serviço com ficha e todos os itens com custo conhecido. */
    covered: z.boolean(),
  })).max(20),
  material_cost_cents: Cents,
  margin_cents: SignedCents,
  covered: z.boolean(),
});
