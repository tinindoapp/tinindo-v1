// Regra de preço do doc06 em inteiros (BigInt): mesma conta da função SQL app.price_compute.
// Usada pela tela (simulador e prévia). A autoridade continua sendo o servidor.
//
//   piso_economico = ceil(custo * 10000 / (10000 - taxa_bps - margem_bps))
//   piso           = max(piso_manual, piso_economico quando calculável)
//   desconto       = min(desconto_regra, teto_aprovado)
//   candidato      = round_half_up(base * (10000 - desconto) / 10000)
//   final          = max(candidato, piso)

export interface PriceInput {
  base_cents: number;
  manual_floor_cents: number;
  estimated_cost_cents: number | null;
  fee_bps: number | null;
  target_margin_bps: number;
  discount_bps: number;
  max_discount_bps: number;
}

export type PriceReason = "BASE_PRICE" | "OFF_PEAK_APPROVED" | "FLOOR_APPLIED";

export type PriceResult =
  | {
      ok: true;
      floor_cents: number;
      economic_floor_cents: number | null;
      /** Sem custo informado: o piso é só o manual e não prova rentabilidade. */
      floor_is_manual_only: boolean;
      effective_discount_bps: number;
      candidate_cents: number;
      final_cents: number;
      reason: PriceReason;
      /** Margem de contribuição estimada (final − custo − taxa); null sem custo. Não é lucro. */
      contribution_cents: number | null;
    }
  | { ok: false; error: "MARGIN_DENOMINATOR" | "FLOOR_ABOVE_BASE"; floor_cents?: number };

const B = (n: number) => BigInt(n);
const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;

export function economicFloor(cost: number | null, feeBps: number | null, marginBps: number): number | null | "INVALID" {
  if (cost === null) return null;
  const denom = 10_000n - B(feeBps ?? 0) - B(marginBps);
  if (denom <= 0n) return "INVALID";
  return Number(ceilDiv(B(cost) * 10_000n, denom));
}

export function computePrice(i: PriceInput): PriceResult {
  const econ = economicFloor(i.estimated_cost_cents, i.fee_bps, i.target_margin_bps);
  if (econ === "INVALID") return { ok: false, error: "MARGIN_DENOMINATOR" };
  const floor = Math.max(i.manual_floor_cents, econ ?? 0);
  if (floor > i.base_cents) return { ok: false, error: "FLOOR_ABOVE_BASE", floor_cents: floor };
  const discount = Math.min(i.discount_bps, i.max_discount_bps);
  const candidate = Number((B(i.base_cents) * (10_000n - B(discount)) + 5_000n) / 10_000n);
  const final = Math.max(candidate, floor);
  const reason: PriceReason = discount === 0 ? "BASE_PRICE" : final > candidate ? "FLOOR_APPLIED" : "OFF_PEAK_APPROVED";
  const fee = i.fee_bps === null ? 0 : Number((B(final) * B(i.fee_bps) + 5_000n) / 10_000n);
  return {
    ok: true,
    floor_cents: floor,
    economic_floor_cents: econ,
    floor_is_manual_only: i.estimated_cost_cents === null,
    effective_discount_bps: discount,
    candidate_cents: candidate,
    final_cents: final,
    reason,
    contribution_cents: i.estimated_cost_cents === null ? null : final - i.estimated_cost_cents - fee,
  };
}

/** Casos fixos do doc06, conferidos aqui e na função SQL (pgTAP). */
export const PRICE_FIXTURES: { name: string; input: PriceInput; final: number; floor: number; reason: PriceReason | "FLOOR_ABOVE_BASE" | "MARGIN_DENOMINATOR" }[] = [
  {
    name: "exemplo do doc06: piso manual R$80, teto 15% de um pedido de 30% → R$85",
    input: { base_cents: 10_000, manual_floor_cents: 8_000, estimated_cost_cents: 4_000, fee_bps: 500, target_margin_bps: 2_500, discount_bps: 3_000, max_discount_bps: 1_500 },
    final: 8_500, floor: 8_000, reason: "OFF_PEAK_APPROVED",
  },
  {
    name: "piso econômico R$57,15 (ceil) prevalece sobre desconto de 50%",
    input: { base_cents: 10_000, manual_floor_cents: 0, estimated_cost_cents: 4_000, fee_bps: 500, target_margin_bps: 2_500, discount_bps: 5_000, max_discount_bps: 5_000 },
    final: 5_715, floor: 5_715, reason: "FLOOR_APPLIED",
  },
  {
    name: "arredondamento half-up: 15% de R$60,01 → R$51,01 (5100,85 → 5101)",
    input: { base_cents: 6_001, manual_floor_cents: 4_500, estimated_cost_cents: null, fee_bps: null, target_margin_bps: 0, discount_bps: 1_500, max_discount_bps: 1_500 },
    final: 5_101, floor: 4_500, reason: "OFF_PEAK_APPROVED",
  },
  {
    name: "regra de terça das fixtures: 15% de R$60 → R$51",
    input: { base_cents: 6_000, manual_floor_cents: 4_500, estimated_cost_cents: 1_500, fee_bps: 500, target_margin_bps: 0, discount_bps: 1_500, max_discount_bps: 1_500 },
    final: 5_100, floor: 4_500, reason: "OFF_PEAK_APPROVED",
  },
  {
    name: "sem desconto: preço base",
    input: { base_cents: 6_000, manual_floor_cents: 4_500, estimated_cost_cents: null, fee_bps: null, target_margin_bps: 0, discount_bps: 0, max_discount_bps: 1_500 },
    final: 6_000, floor: 4_500, reason: "BASE_PRICE",
  },
  {
    name: "piso maior que a base bloqueia a oferta (não eleva o preço em silêncio)",
    input: { base_cents: 5_000, manual_floor_cents: 0, estimated_cost_cents: 4_000, fee_bps: 500, target_margin_bps: 2_500, discount_bps: 1_000, max_discount_bps: 1_000 },
    final: 0, floor: 5_715, reason: "FLOOR_ABOVE_BASE",
  },
  {
    name: "taxa + margem ≥ 100% é configuração inválida",
    input: { base_cents: 10_000, manual_floor_cents: 0, estimated_cost_cents: 100, fee_bps: 5_000, target_margin_bps: 5_000, discount_bps: 1_000, max_discount_bps: 1_000 },
    final: 0, floor: 0, reason: "MARGIN_DENOMINATOR",
  },
];
