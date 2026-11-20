// Configuração guiada (P44). Aditivos ao v1; ver ADR-0035.
// O estado de cada passo é calculado no servidor pelos dados reais (P01, P02, P03, P07, P09, P12): `done` é
// consequência do dado existir. Modelos de serviço entram só por migration e são sugestão; criar serviços e aplicar o
// rascunho "descreva seu negócio" são comandos idempotentes que o dono confirma campo a campo. Nada muda sozinho.
import { z } from "zod";
import { Cents, IsoDateTime, LocalTime, Uuid, WeeklyWindow } from "./common.ts";
import { Profession } from "./context.ts";

export const SetupStepCode = z.enum([
  "hours", "service", "cancellation_policy", "profile", "first_customer", "photo_whatsapp", "channel", "first_cash",
]);
export type SetupStepCode = z.infer<typeof SetupStepCode>;

export const SetupStep = z.object({
  step: SetupStepCode,
  required: z.boolean(),
  title: z.string(),
  /** Por que o passo importa; null quando já está feito. */
  why: z.string().nullable(),
  /** Caminho da tela que resolve o passo. */
  link: z.string().regex(/^\/app(\/[a-z0-9-]+)*$/),
  done: z.boolean(),
  /** Data real do dado que concluiu o passo (criação do serviço, publicação do perfil…). */
  done_at: IsoDateTime.nullable(),
  /** Opcional dispensado pelo dono ("agora não"); nunca true num passo feito. */
  dismissed: z.boolean(),
});
export type SetupStep = z.infer<typeof SetupStep>;

export const SetupProgress = z.object({
  business_name: z.string(),
  profession: Profession,
  created_at: IsoDateTime,
  steps: z.array(SetupStep).length(8),
  done_count: z.int().min(0).max(8),
  /** Feitos ou dispensados: o cartão some quando chega a `total`. */
  resolved_count: z.int().min(0).max(8),
  total: z.literal(8),
  /** Próximo passo a mostrar em destaque (obrigatórios primeiro); null quando nada falta. */
  next: SetupStepCode.nullable(),
  /** Todos os obrigatórios feitos: o negócio recebe reservas pelo link. */
  ready: z.boolean(),
  ready_at: IsoDateTime.nullable(),
  ready_in_24h: z.boolean(),
});
export type SetupProgress = z.infer<typeof SetupProgress>;

export const SetupProgressInput = z.object({});
export const SetupProgressOutput = SetupProgress;

export const SetupDismissInput = z.object({ step: SetupStepCode, dismissed: z.boolean().default(true) });
export const SetupDismissOutput = z.object({ step: SetupStepCode, dismissed: z.boolean(), progress: SetupProgress });
export type SetupDismissOutput = z.infer<typeof SetupDismissOutput>;

export const SetupServiceTemplate = z.object({
  code: z.string().regex(/^[a-z0-9_]{3,40}$/),
  /** `package` é só informação (pacote vende-se no Caixa): não vira serviço. */
  kind: z.enum(["service", "package"]),
  name: z.string().min(1).max(120),
  duration_min: z.int().min(5).max(1440),
  buffer_before_min: z.int().min(0).max(240),
  buffer_after_min: z.int().min(0).max(240),
  /** Faixa típica, ponto de partida que o dono revisa; null = sem faixa. */
  price_from_cents: Cents.nullable(),
  price_to_cents: Cents.nullable(),
  /** Já existe serviço ativo com este nome no catálogo. */
  exists: z.boolean(),
});
export type SetupServiceTemplate = z.infer<typeof SetupServiceTemplate>;
export const SetupTemplatesInput = z.object({});
export const SetupTemplatesOutput = z.object({ profession: Profession, templates: z.array(SetupServiceTemplate).max(50) });
export type SetupTemplatesOutput = z.infer<typeof SetupTemplatesOutput>;

/** Um serviço confirmado pelo dono (nome, duração e preço revisados); o modelo só dá os intervalos. */
export const SetupServiceDraft = z.object({
  template_code: z.string().regex(/^[a-z0-9_]{3,40}$/).nullable().default(null),
  name: z.string().trim().min(1).max(120),
  duration_min: z.int().min(5).max(1440),
  base_price_cents: Cents,
});
export type SetupServiceDraft = z.infer<typeof SetupServiceDraft>;
export const SetupCreatedService = z.object({
  id: Uuid,
  template_code: z.string().nullable(),
  name: z.string(),
  duration_min: z.int().min(5).max(1440),
  base_price_cents: Cents,
});
export const SetupServicesApplyInput = z.object({ services: z.array(SetupServiceDraft).min(1).max(20) });
export const SetupServicesApplyOutput = z.object({ created: z.array(SetupCreatedService).max(20), progress: SetupProgress });
export type SetupServicesApplyOutput = z.infer<typeof SetupServicesApplyOutput>;
export type SetupCreatedService = z.infer<typeof SetupCreatedService>;

/** Rascunho revisado: null em `profession`/`hours` = não mexer; `hours` substitui o expediente da agenda principal. */
export const SetupDraftApplyInput = z.object({
  profession: Profession.nullable().default(null),
  hours: z.array(WeeklyWindow).max(50).nullable().default(null),
  services: z.array(SetupServiceDraft).max(20).default([]),
}).refine((v) => v.profession !== null || v.hours !== null || v.services.length > 0, { message: "nada a aplicar", path: ["hours"] });
export const SetupDraftApplyOutput = z.object({
  profession: Profession,
  hours: z.array(WeeklyWindow).max(50).nullable(),
  created: z.array(SetupCreatedService).max(20),
  progress: SetupProgress,
});
export type SetupDraftApplyOutput = z.infer<typeof SetupDraftApplyOutput>;

/** Rascunho estruturado da frase do negócio (analisador por regras; o P46 devolve o mesmo formato). */
export const SetupDescribeDraft = z.object({
  profession: Profession.nullable(),
  /** Quantas pessoas atendem (1 = "sozinho"); null quando a frase não diz. */
  team_size: z.int().min(1).max(50).nullable(),
  /** Dias de atendimento (0 = domingo), em ordem. */
  weekdays: z.array(z.int().min(0).max(6)).max(7),
  start: LocalTime.nullable(),
  end: LocalTime.nullable(),
  /** Pausa do almoço quando a frase diz ("das 9 às 19 com almoço das 12 às 13"). */
  pause: z.object({ start: LocalTime, end: LocalTime }).nullable(),
  /** Serviços citados na frase (sem preço: preço é do dono). */
  services: z.array(z.string().min(1).max(120)).max(20),
  /** O que o analisador não entendeu, para a tela pedir ao dono. */
  unknown: z.array(z.enum(["profession", "weekdays", "hours"])),
});
export type SetupDescribeDraft = z.infer<typeof SetupDescribeDraft>;

// ---- setup.describe (P50; registrado no recado #115). A leitura da frase mora em _shared/domain/setup/describe.ts.

/** Campos do rascunho que podem ser recusados, lidos com ressalva ou preenchidos pelo assistente. */
export const DescribeField = z.enum(["profession", "team_size", "weekdays", "hours", "services"]);
export type DescribeField = z.infer<typeof DescribeField>;
/** `rules` = lido pelas regras; `assistant` = preenchido pelo modelo de linguagem; null = não lido. */
export const DescribeSource = z.enum(["rules", "assistant"]);
export type DescribeSource = z.infer<typeof DescribeSource>;

export const DescribeServiceDraft = z.object({
  name: z.string().min(1).max(120),
  /** Modelo da profissão com o mesmo nome (de onde vêm a duração e a faixa); null = serviço sem modelo. */
  template_code: z.string().regex(/^[a-z0-9_]{3,40}$/).nullable(),
  /** Duração dita na frase ou a do modelo; null = o dono informa. */
  duration_min: z.int().min(5).max(1440).nullable(),
  /** Só quando a frase diz o preço. A faixa do modelo é dica, nunca preço. */
  price_cents: Cents.nullable(),
  price_from_cents: Cents.nullable(),
  price_to_cents: Cents.nullable(),
  /** true = citado na frase; false = sugestão do modelo da profissão (a tela mostra desmarcado). */
  cited: z.boolean(),
});
export type DescribeServiceDraft = z.infer<typeof DescribeServiceDraft>;

export const DescribeNote = z.object({
  field: DescribeField,
  /** `refused` = o campo ficou sem valor e o texto diz por quê; `check` = lido com uma suposição que o dono confere. */
  level: z.enum(["refused", "check"]),
  text: z.string().min(1).max(300),
});
export type DescribeNote = z.infer<typeof DescribeNote>;

/** Rascunho completo da frase: o contrato v1 (`SetupDescribeDraft`) mais o expediente por dia, os serviços com modelo e as ressalvas. */
export const BusinessDescription = SetupDescribeDraft.extend({
  /** Expediente inteiro, um bloco por período de cada dia (dois turnos e dias com horários diferentes cabem aqui). */
  windows: z.array(WeeklyWindow).max(50),
  service_drafts: z.array(DescribeServiceDraft).max(20),
  /** "pacote com N sessões": informação para o Caixa; não vira serviço nem equipe. */
  packages: z.array(z.object({ sessions: z.int().min(2).max(100), service: z.string().max(120).nullable() })).max(5),
  /** A frase diz que o atendimento é na casa do cliente. */
  at_home: z.boolean(),
  notes: z.array(DescribeNote).max(20),
  sources: z.object({
    profession: DescribeSource.nullable(), team_size: DescribeSource.nullable(), weekdays: DescribeSource.nullable(),
    hours: DescribeSource.nullable(), services: DescribeSource.nullable(),
  }),
});
export type BusinessDescription = z.infer<typeof BusinessDescription>;

export const SetupDescribeInput = z.object({ sentence: z.string().trim().min(8).max(500) });
/** `assistant`: o modelo de linguagem foi consultado para esta frase (false com LLM_PROVIDER=none ou quando as regras bastaram). */
export const SetupDescribeOutput = BusinessDescription.extend({ assistant: z.boolean() });
export type SetupDescribeOutput = z.infer<typeof SetupDescribeOutput>;
