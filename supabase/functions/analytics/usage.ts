// P32 bloco 1 · rotas de uso do app na função `analytics`. Ficam fora do registro v1 (como o setup.describe nasceu):
// os schemas moram aqui até o integrador registrá-los (recado). Nenhuma leva dado pessoal: o banco só aceita
// rota sem id, nome de operação, resultado e código (ver migration p32_uso).
import { z } from "zod";
import { route, type Route } from "../_shared/http/rpc-handler.ts";

const Uuid = z.uuid();
const IsoDateTime = z.iso.datetime({ offset: true });

export const UsageEventIn = z.object({
  kind: z.enum(["screen", "command"]),
  name: z.string().min(1).max(160),
  outcome: z.enum(["ok", "refused", "error"]).nullable(),
  code: z.string().max(40).nullable(),
  at: IsoDateTime,
});
export const UsageRecordInput = z.object({ batch_id: Uuid, events: z.array(UsageEventIn).max(50) });
export const UsageRecordOutput = z.object({
  recorded: z.int().min(0).max(50),
  enabled: z.boolean(),
  duplicate: z.boolean().optional(),
});

export const UsageSettings = z.object({
  enabled: z.boolean(),
  version: z.int().min(0),
  retention_days: z.int().min(0),
});
export const UsageSettingsGetInput = z.object({}).strict();
export const UsageSettingsSetInput = z.object({ enabled: z.boolean(), expected_version: z.int().min(0) });

/** Rotas de uso: gravar o lote (leitura sem chave: o lote tem id próprio e não duplica) e ligar ou desligar. */
export const USAGE_ROUTES: Record<string, Route> = {
  "usage.record": route({
    rpc: "usage_record", input: UsageRecordInput, output: UsageRecordOutput, command: false,
    args: (i) => ({ p_batch_id: i.batch_id, p_events: i.events }),
  }),
  "usage.settings": route({
    rpc: "usage_settings_get", input: UsageSettingsGetInput, output: UsageSettings, command: false,
    args: () => ({}),
  }),
  "usage.settings_set": route({
    rpc: "usage_settings_set", input: UsageSettingsSetInput, output: UsageSettings, command: true,
    args: (i) => ({ p_enabled: i.enabled, p_expected_version: i.expected_version }),
  }),
};
