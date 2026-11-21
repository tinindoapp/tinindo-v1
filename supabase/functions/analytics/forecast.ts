// P32 bloco 5 · previsão simples na função `analytics`: ocupação esperada da próxima semana e risco de falta por
// horário, por regra e média histórica, só com 8 semanas fechadas; acerto contra o real e contra "igual à semana
// anterior". Só leitura: nenhuma ação automática. Fora do registro v1 até o integrador registrar (recado #197).
import { z } from "zod";
import { route, type Route } from "../_shared/http/rpc-handler.ts";

const IsoDateTime = z.iso.datetime({ offset: true });
const LocalDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Weekday = z.int().min(0).max(6);
const Ratio = z.number().min(0).max(1);

export const ForecastDay = z.object({
  date: LocalDate,
  weekday: Weekday,
  expected_bookings: z.number().min(0),
  already_booked: z.int().min(0),
  open_minutes: z.int().min(0),
  expected_occupancy: Ratio.nullable(),
});
export const ForecastSlot = z.object({
  weekday: Weekday,
  hour: z.int().min(0).max(23),
  denominator: z.int().min(0),
  no_shows: z.int().min(0),
  basis: z.enum(["slot", "overall"]),
  risk: Ratio.nullable(),
});
export const ForecastWeek = z.object({
  starts_at: IsoDateTime,
  actual: z.int().min(0),
  predicted: z.number().min(0),
  baseline: z.int().min(0),
  model_error: z.number().min(0),
  baseline_error: z.number().min(0),
});

export const ForecastInput = z.object({ ref: LocalDate });
export const ForecastOutput = z.object({
  status: z.enum(["ok", "insufficient"]),
  weeks_of_history: z.int().min(0),
  weeks_needed: z.literal(8),
  target: z.object({ starts_at: IsoDateTime, ends_at: IsoDateTime }),
  timezone: z.string(),
  as_of: IsoDateTime,
  days: z.array(ForecastDay),
  no_show_slots: z.array(ForecastSlot),
  overall_no_show: z.object({ denominator: z.int().min(0), no_shows: z.int().min(0), risk: Ratio.nullable() }).nullable(),
  backtest: z.array(ForecastWeek),
  accuracy: z.object({
    weeks: z.int().min(1),
    actual: z.int().min(0),
    model_error: z.number().min(0),
    baseline_error: z.number().min(0),
    model_accuracy: Ratio.nullable(),
    baseline_accuracy: Ratio.nullable(),
    beats_baseline: z.boolean(),
  }).nullable(),
});
export type ForecastOutput = z.infer<typeof ForecastOutput>;

export const FORECAST_ROUTES: Record<string, Route> = {
  "forecast.get": route({ rpc: "forecast_week", input: ForecastInput, output: ForecastOutput, command: false, args: (i) => ({ p_ref: i.ref }) }),
};
