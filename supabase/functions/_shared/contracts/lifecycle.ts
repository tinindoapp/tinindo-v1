// Relacionamento (P13). Aditivos ao v1; ver ADR-0019.
// Réguas determinísticas sobre o outbox; cada passo é um registro com estado. Enviado ao canal ≠ entregue (P12).
// Reativação só como campanha aprovada pelo dono (público visto + teto). Consentimento por finalidade.
import { z } from "zod";
import { IsoDateTime, Uuid } from "./common.ts";

export const LifecycleRule = z.enum(["confirmation", "reminder", "quote_followup", "receivable_reminder", "reactivation"]);
export type LifecycleRule = z.infer<typeof LifecycleRule>;
export const LifecycleStepStatus = z.enum(["scheduled", "deferred", "sent", "manual", "shared", "skipped", "cancelled"]);
export type LifecycleStepStatus = z.infer<typeof LifecycleStepStatus>;
export const ConsentPurpose = z.enum(["transactional", "marketing"]);

export const LifecycleSettings = z.object({
  enabled: z.boolean(),
  confirmation: z.boolean(),
  /** Horas antes do atendimento (até 4 valores entre 1 e 48). */
  reminder_hours: z.array(z.int().min(1).max(48)).max(4),
  quote_followup_days: z.int().min(1).max(14),
  receivable_reminder: z.boolean(),
  reactivation_days: z.int().min(14).max(365),
  /** Envios ao canal por dia; além dele o passo é adiado, nunca descartado. */
  daily_budget: z.int().min(0).max(500),
  /** 0 = ainda padrão (nunca salvo). */
  version: z.int().min(0),
});
export type LifecycleSettings = z.infer<typeof LifecycleSettings>;
export const LifecycleSettingsGetInput = z.object({});
export const LifecycleSettingsOutput = z.object({ settings: LifecycleSettings, sent_today: z.int().min(0) });
export const LifecycleSettingsSaveInput = z.object({
  settings: LifecycleSettings.omit({ version: true }).partial(),
  expected_version: z.int().min(0),
});

export const LifecycleStep = z.object({
  id: Uuid,
  rule: LifecycleRule,
  step_key: z.string(),
  aggregate_type: z.enum(["booking", "quote", "receivable", "customer"]),
  aggregate_id: Uuid,
  customer_id: Uuid.nullable(),
  customer_name: z.string().nullable(),
  campaign_id: Uuid.nullable(),
  due_at: IsoDateTime,
  status: LifecycleStepStatus,
  skip_reason: z.string().nullable(),
  template_code: z.string(),
  /** Texto pronto (dado da cliente, não instrução). */
  body: z.string(),
  channel_message_id: Uuid.nullable(),
  /** Estado da mensagem no canal (P12), quando enviada. */
  message_status: z.string().nullable(),
  resolved_at: IsoDateTime.nullable(),
  created_at: IsoDateTime,
  version: z.int().min(1),
});
export type LifecycleStep = z.infer<typeof LifecycleStep>;
export const LifecycleStepsListInput = z.object({ status: LifecycleStepStatus.nullable().default(null) });
export const LifecycleStepsListOutput = z.object({ steps: z.array(LifecycleStep).max(200), counts: z.record(z.string(), z.int().min(0)) });
export const LifecycleStepRefInput = z.object({ step_id: Uuid });
export const LifecycleStepOutput = z.object({ step: LifecycleStep });

export const LifecycleConsentSetInput = z.object({ customer_id: Uuid, purpose: ConsentPurpose, granted: z.boolean() });
export const LifecycleConsentOutput = z.object({ customer_id: Uuid, purpose: ConsentPurpose, granted: z.boolean() });

export const AudienceCustomer = z.object({ customer_id: Uuid, name: z.string(), last_visit_at: IsoDateTime.nullable(), has_channel: z.boolean() });
export const LifecycleAudienceInput = z.object({});
export const LifecycleAudienceOutput = z.object({
  customers: z.array(AudienceCustomer).max(500),
  /** Hash do público visto: a aprovação precisa citá-lo. */
  audience_hash: z.string().regex(/^[0-9a-f]{64}$/),
  reactivation_days: z.int().min(14).max(365),
  daily_budget: z.int().min(0).max(500),
  sent_today: z.int().min(0),
});
export const LifecycleCampaignApproveInput = z.object({ audience_hash: z.string().regex(/^[0-9a-f]{64}$/), max_sends: z.int().min(1).max(500) });
export const LifecycleCampaign = z.object({
  id: Uuid,
  kind: z.literal("reactivation"),
  audience_count: z.int().min(0),
  max_sends: z.int().min(1).max(500),
  status: z.enum(["approved", "cancelled"]),
  created_at: IsoDateTime,
  scheduled: z.int().min(0).optional(),
  sent: z.int().min(0).optional(),
  skipped: z.int().min(0).optional(),
});
export type LifecycleCampaign = z.infer<typeof LifecycleCampaign>;
export const LifecycleCampaignOutput = z.object({ campaign: LifecycleCampaign });
export const LifecycleCampaignListInput = z.object({});
export const LifecycleCampaignListOutput = z.object({ campaigns: z.array(LifecycleCampaign).max(50) });
