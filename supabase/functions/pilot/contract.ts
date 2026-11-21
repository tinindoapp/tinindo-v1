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
