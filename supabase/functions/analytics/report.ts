// P32 bloco 4 · relatório ao profissional ("Sua semana" e "Seu mês") na função `analytics`. Fora do registro v1 até o
// integrador registrar (recado #197). Cada número traz denominador e "insufficient" quando não há base: nunca vira 0.
import { z } from "zod";
import { route, type Route } from "../_shared/http/rpc-handler.ts";

const IsoDateTime = z.iso.datetime({ offset: true });
const LocalDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const ReportMetric = z.object({
  value: z.number().nullable(),
  denominator: z.int().min(0),
  status: z.enum(["ok", "insufficient"]),
  note: z.string(),
});
const Money = z.object({ value: z.int().min(0), status: z.literal("ok"), note: z.string(), denominator: z.int().min(0).optional() });
const Slot = z.object({ weekday: z.int().min(0).max(6), hour: z.int().min(0).max(23), count: z.int().min(0) });

export const ReportInput = z.object({ kind: z.enum(["week", "month"]), ref: LocalDate });
export const ReportOutput = z.object({
  kind: z.enum(["week", "month"]),
  period: z.object({ starts_at: IsoDateTime, ends_at: IsoDateTime }),
  until: IsoDateTime,
  in_progress: z.boolean(),
  timezone: z.string(),
  as_of: IsoDateTime,
  services_done: ReportMetric,
  no_shows: ReportMetric,
  received_cents: Money,
  to_receive_cents: Money,
  returned: ReportMetric,
  not_returned: ReportMetric,
  busiest: Slot.nullable(),
  quietest: Slot.nullable(),
  hours_status: z.enum(["ok", "insufficient", "no_hours"]),
  hours_denominator: z.int().min(0),
  hours_note: z.string(),
});
export type ReportOutput = z.infer<typeof ReportOutput>;
export type ReportMetric = z.infer<typeof ReportMetric>;

export const REPORT_ROUTES: Record<string, Route> = {
  "report.get": route({ rpc: "report_period", input: ReportInput, output: ReportOutput, command: false, args: (i) => ({ p_kind: i.kind, p_ref: i.ref }) }),
};
