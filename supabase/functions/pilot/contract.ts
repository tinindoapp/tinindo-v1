// P32 · Contratos da função `pilot` (só a equipe Tinindo). Fora do registro v1 até o integrador registrar (recado).
// Tudo aqui é contagem, data ou nome de tela/operação: nunca conteúdo, valor, nome de cliente ou telefone.
import { z } from "zod";

const Uuid = z.uuid();
const IsoDateTime = z.iso.datetime({ offset: true });

export const FunnelStepKey = z.enum(["signup", "configured", "link_published", "first_booking", "first_service", "first_payment", "returned"]);
export const FunnelStep = z.object({
  key: FunnelStepKey,
  done: z.boolean(),
  at: IsoDateTime.nullable(),
  minutes_since_signup: z.int().min(0).nullable(),
  minutes_since_previous: z.int().min(0).nullable(),
});
export const BusinessFunnel = z.object({
  tenant_id: Uuid,
  name: z.string().min(1).max(120),
  profession: z.string(),
  signup_at: IsoDateTime,
  timezone: z.string(),
  steps: z.array(FunnelStep).length(7),
  done: z.int().min(0).max(7),
  total: z.literal(7),
});
export const PilotFunnelInput = z.object({}).strict();
export const PilotFunnelOutput = z.object({
  businesses: z.array(BusinessFunnel).max(200),
  truncated: z.object({ businesses: z.boolean() }),
});
export type BusinessFunnel = z.infer<typeof BusinessFunnel>;
export type FunnelStepKey = z.infer<typeof FunnelStepKey>;

// ---------------------------------------------------------------------------------------------------------------------
// Bloco 3 · painel do piloto
const TimeRange = z.object({ starts_at: IsoDateTime, ends_at: IsoDateTime });
const Count = z.int().min(0);
export const PilotBusiness = z.object({
  tenant_id: Uuid,
  name: z.string().min(1).max(120),
  profession: z.string(),
  usage_enabled: z.boolean(),
  funnel: BusinessFunnel.omit({ name: true, profession: true }),
  usage: z.object({
    active_days: Count,
    screens: z.array(z.object({ name: z.string().max(160), count: Count })).max(50),
    commands: z.array(z.object({ name: z.string().max(130), ok: Count, refused: Count, error: Count })).max(50),
    problems: z.array(z.object({
      name: z.string().max(130), outcome: z.enum(["refused", "error"]), code: z.string().max(40).nullable(), count: Count, last_at: IsoDateTime,
    })).max(30),
    opened_30d: z.array(z.string().max(160)),
  }),
  cost: z.object({
    assistant_usd: z.number().min(0),
    assistant_calls: Count,
    assistant_months: z.string(),
    messages_template: Count,
    messages_text: Count,
    messages_failed: Count,
  }),
  counts: z.object({ bookings_created: Count, services_done: Count, no_shows: Count, cancelled: Count, payments: Count }),
});
export const PilotPanelInput = z.object({ period: TimeRange });
export const PilotPanelOutput = z.object({
  period: TimeRange,
  as_of: IsoDateTime,
  businesses: z.array(PilotBusiness).max(200),
  truncated: z.object({ businesses: z.boolean() }),
});
export type PilotBusiness = z.infer<typeof PilotBusiness>;
export type PilotPanelOutput = z.infer<typeof PilotPanelOutput>;
