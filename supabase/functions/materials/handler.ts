// Edge Function `materials` (P30): estoque, compras, uso por serviço e margem. Cada operação é uma RPC transacional do
// dono (ver _shared/http/rpc-handler.ts). Saldo e custo médio são do banco; aqui só validação e transporte.
import {
  MaterialAdjustInput,
  MaterialBookingsInput,
  MaterialBookingsOutput,
  MaterialConsumeInput,
  MaterialConsumeReverseInput,
  MaterialConsumptionOutput,
  MaterialItemOutput,
  MaterialItemSaveInput,
  MaterialListInput,
  MaterialListOutput,
  MaterialMarginInput,
  MaterialMarginOutput,
  MaterialMovementsInput,
  MaterialMovementsOutput,
  MaterialPurchaseInput,
  MaterialPurchaseOutput,
  MaterialPurchaseReverseInput,
  MaterialQuoteCostInput,
  MaterialQuoteCostOutput,
  MaterialUsageOutput,
  MaterialUsageSaveInput,
} from "../_shared/contracts/index.ts";
import { createRpcHandler, type Route, route, type RpcHandlerDeps } from "../_shared/http/rpc-handler.ts";

export type MaterialsDeps = RpcHandlerDeps;

export const MATERIALS_ROUTES: Record<string, Route> = {
  "materials.list": route({ rpc: "materials_list", input: MaterialListInput, output: MaterialListOutput, command: false, args: () => ({}) }),
  "materials.item_save": route({
    rpc: "materials_item_save", input: MaterialItemSaveInput, output: MaterialItemOutput, command: true,
    args: (i) => ({ p_item_id: i.item_id, p_expected_version: i.expected_version, p_name: i.name, p_kind: i.kind, p_unit: i.unit, p_active: i.active, p_min_qty: i.min_qty }),
  }),
  "materials.usage_save": route({
    rpc: "materials_usage_save", input: MaterialUsageSaveInput, output: MaterialUsageOutput, command: true,
    args: (i) => ({ p_service_id: i.service_id, p_item_id: i.item_id, p_quantity: i.quantity }),
  }),
  "materials.purchase": route({
    rpc: "materials_purchase", input: MaterialPurchaseInput, output: MaterialPurchaseOutput, command: true,
    args: (i) => ({ p_supplier: i.supplier, p_purchased_at: i.purchased_at, p_lines: i.lines, p_record_expense: i.record_expense }),
  }),
  "materials.purchase_reverse": route({
    rpc: "materials_purchase_reverse", input: MaterialPurchaseReverseInput, output: MaterialPurchaseOutput, command: true,
    args: (i) => ({ p_purchase_id: i.purchase_id, p_expected_version: i.expected_version }),
  }),
  "materials.adjust": route({
    rpc: "materials_adjust", input: MaterialAdjustInput, output: MaterialItemOutput, command: true,
    args: (i) => ({ p_item_id: i.item_id, p_expected_version: i.expected_version, p_counted: i.counted, p_reason: i.reason }),
  }),
  "materials.consume": route({
    rpc: "materials_consume", input: MaterialConsumeInput, output: MaterialConsumptionOutput, command: true,
    args: (i) => ({ p_booking_id: i.booking_id, p_lines: i.lines }),
  }),
  "materials.consume_reverse": route({
    rpc: "materials_consume_reverse", input: MaterialConsumeReverseInput, output: MaterialConsumptionOutput, command: true,
    args: (i) => ({ p_consumption_id: i.consumption_id, p_expected_version: i.expected_version }),
  }),
  "materials.movements": route({
    rpc: "materials_movements", input: MaterialMovementsInput, output: MaterialMovementsOutput, command: false,
    args: (i) => ({ p_item_id: i.item_id, p_from: i.period.starts_at, p_to: i.period.ends_at }),
  }),
  "materials.bookings": route({
    rpc: "materials_bookings", input: MaterialBookingsInput, output: MaterialBookingsOutput, command: false,
    args: (i) => ({ p_from: i.period.starts_at, p_to: i.period.ends_at }),
  }),
  "materials.margin": route({
    rpc: "materials_margin", input: MaterialMarginInput, output: MaterialMarginOutput, command: false,
    args: (i) => ({ p_from: i.period.starts_at, p_to: i.period.ends_at }),
  }),
  "materials.quote_cost": route({
    rpc: "materials_quote_cost", input: MaterialQuoteCostInput, output: MaterialQuoteCostOutput, command: false,
    args: (i) => ({ p_quote_id: i.quote_id }),
  }),
};

export function createMaterialsHandler(deps: MaterialsDeps) {
  return createRpcHandler("materials", MATERIALS_ROUTES, deps);
}
