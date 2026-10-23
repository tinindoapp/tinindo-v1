// Metas e conteúdo (P22). Aditivos ao v1; ver ADR-0023.
// Metas por indicador do P18 (progresso = o indicador, com denominador); sugestões só por regras sobre dado existente
// (sem LLM), com decisão do dono e acompanhamento observacional; conteúdo pré-aprovado por profissão, publicado só
// pelo escopo autorizado do P09 (perfil publicado com o campo `bio` escolhido).
import { z } from "zod";
import { IsoDateTime, Uuid } from "./common.ts";
import { Profession } from "./context.ts";

export const GoalMetricKey = z.enum(["occupancy", "no_show", "cancellation", "waitlist_acceptance", "quote_acceptance", "received", "expenses", "charge_coverage", "reminders"]);
export type GoalMetricKey = z.infer<typeof GoalMetricKey>;
export const GoalProgress = z.object({
  value: z.number().nullable(),
  numerator: z.number().nullable(),
  denominator: z.number().nullable(),
  status: z.enum(["ok", "insufficient", "unavailable"]),
  note: z.string().nullable(),
  /** 0–1: quanto do caminho até a meta já está feito; null sem dado suficiente. */
  attainment: z.number().min(0).max(1).nullable(),
  achieved: z.boolean().nullable(),
});
export const Goal = z.object({
  id: Uuid,
  metric_key: GoalMetricKey,
  label: z.string().nullable(),
  unit: z.enum(["ratio", "minutes", "cents"]).nullable(),
  target: z.number().min(0),
  direction: z.enum(["up", "down"]),
  /** AAAA-MM-01 no fuso do negócio. */
  period_start: z.string().regex(/^\d{4}-\d{2}-01$/),
  note: z.string().nullable(),
  status: z.enum(["active", "archived"]),
  created_at: IsoDateTime,
  version: z.int().min(1),
  progress: GoalProgress,
});
export type Goal = z.infer<typeof Goal>;
export const GoalSaveInput = z.object({
  goal_id: Uuid.nullable().default(null),
  expected_version: z.int().min(1).nullable().default(null),
  metric_key: GoalMetricKey,
  /** ratio: 0–1; cents: inteiro. */
  target: z.number().min(0),
  period_start: z.string().regex(/^\d{4}-\d{2}-01$/).nullable().default(null),
  note: z.string().trim().max(200).nullable().default(null),
});
export const GoalArchiveInput = z.object({ goal_id: Uuid, expected_version: z.int().min(1) });
export const GoalOutput = z.object({ goal: Goal });
export const GoalListInput = z.object({});
export const GoalListOutput = z.object({
  month_start: IsoDateTime,
  month_end: IsoDateTime,
  goals: z.array(Goal).max(50),
  /** Indicadores do mês corrente (mesma definição do P18), para escolher metas com o dado à vista. */
  metrics: z.array(z.object({ key: z.string(), label: z.string(), unit: z.enum(["ratio", "minutes", "cents"]), value: z.number().nullable(),
    numerator: z.number().nullable(), denominator: z.number().nullable(), status: z.enum(["ok", "insufficient", "unavailable"]), note: z.string() })),
});

export const AdviceSuggestion = z.object({
  rule_code: z.string().regex(/^[a-z0-9_]{3,40}$/),
  metric_key: GoalMetricKey.nullable(),
  title: z.string(),
  text: z.string(),
  /** Rota da tela onde a ação acontece (nunca uma ação automática). */
  route: z.string().startsWith("/app/"),
  /** Contagens e taxas que geraram a sugestão; nunca nomes. */
  evidence: z.record(z.string(), z.unknown()),
});
export const AdviceOutcome = z.enum(["improved", "worsened", "unchanged", "insufficient"]);
export const AdviceDecision = z.object({
  id: Uuid,
  rule_code: z.string(),
  metric_key: GoalMetricKey.nullable(),
  decision: z.enum(["accepted", "dismissed"]),
  evidence: z.record(z.string(), z.unknown()),
  metric_before: z.record(z.string(), z.unknown()).nullable(),
  metric_after: z.record(z.string(), z.unknown()).nullable(),
  /** Variação observada 30 dias depois; nunca efeito atribuído. */
  outcome: AdviceOutcome.nullable(),
  decided_at: IsoDateTime,
  follow_up_at: IsoDateTime,
});
export const AdviceListInput = z.object({});
export const AdviceListOutput = z.object({ suggestions: z.array(AdviceSuggestion).max(20), decisions: z.array(AdviceDecision).max(50) });
export const AdviceDecideInput = z.object({ rule_code: z.string().regex(/^[a-z0-9_]{3,40}$/), decision: z.enum(["accepted", "dismissed"]) });
export const AdviceDecideOutput = z.object({ decision: AdviceDecision });

export const ContentTemplate = z.object({
  code: z.string(),
  profession: z.union([Profession, z.literal("all")]),
  kind: z.enum(["bio", "post"]),
  title: z.string(),
  body: z.string(),
  /** Modelo com os dados públicos do negócio preenchidos. */
  preview: z.string(),
  approved_by: z.string(),
});
export const PublishedContent = z.object({ template_code: z.string(), body: z.string(), published_at: IsoDateTime, version: z.int().min(1) });
export const ContentListInput = z.object({});
export const ContentListOutput = z.object({
  profession: Profession,
  /** Escopo autorizado (P09): perfil publicado e campo `bio` escolhido pelo dono. */
  scope: z.object({ profile_published: z.boolean(), bio_field: z.boolean() }),
  published: PublishedContent.nullable(),
  templates: z.array(ContentTemplate).max(50),
});
export const ContentPublishInput = z.object({ template_code: z.string().regex(/^[a-z0-9_]{3,40}$/) });
export const ContentPublishOutput = z.object({ published: PublishedContent.nullable() });
export const ContentUnpublishInput = z.object({ expected_version: z.int().min(1) });
