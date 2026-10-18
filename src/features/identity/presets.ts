// Onboarding configurável por profissão (beleza e personal no piloto). Só apresentação e
// sugestões: o servidor valida enums e limites; nada aqui decide regra de negócio.
import type { Profession } from "@contracts";
import type { OnboardingGoal } from "@contracts";

export type Segment = "beleza" | "personal" | "outro";

export interface ProfessionPreset {
  label: string;
  segment: Segment;
  /** Como o profissional chama quem atende. */
  clientNoun: { one: string; many: string };
  /** Objetivos na ordem mais comum para a profissão (todos continuam disponíveis). */
  goalOrder: readonly OnboardingGoal[];
  /** Sugestão inicial de antecedência para cancelar sem multa; a pessoa confirma ou muda. */
  suggestedNoticeHours: number;
  /** Exemplos para o próximo passo (catálogo do P02). Sem preço: preço é do profissional. */
  serviceExamples: readonly { name: string; duration_min: number }[];
}

export const PROFESSION_PRESETS: Record<Profession, ProfessionPreset> = {
  barber: {
    label: "Barbearia",
    segment: "beleza",
    clientNoun: { one: "cliente", many: "clientes" },
    goalOrder: ["fill_schedule", "reduce_no_shows", "organize_clients", "track_payments", "save_admin_time"],
    suggestedNoticeHours: 2,
    serviceExamples: [
      { name: "Corte", duration_min: 30 },
      { name: "Barba", duration_min: 20 },
    ],
  },
  hairdresser: {
    label: "Cabeleireiro(a)",
    segment: "beleza",
    clientNoun: { one: "cliente", many: "clientes" },
    goalOrder: ["fill_schedule", "organize_clients", "reduce_no_shows", "track_payments", "save_admin_time"],
    suggestedNoticeHours: 4,
    serviceExamples: [
      { name: "Corte", duration_min: 45 },
      { name: "Coloração", duration_min: 120 },
    ],
  },
  personal_trainer: {
    label: "Personal trainer",
    segment: "personal",
    clientNoun: { one: "aluno(a)", many: "alunos" },
    goalOrder: ["track_payments", "reduce_no_shows", "fill_schedule", "organize_clients", "save_admin_time"],
    suggestedNoticeHours: 12,
    serviceExamples: [
      { name: "Sessão de treino", duration_min: 60 },
      { name: "Aula experimental", duration_min: 45 },
    ],
  },
  other: {
    label: "Outro serviço",
    segment: "outro",
    clientNoun: { one: "cliente", many: "clientes" },
    goalOrder: ["organize_clients", "fill_schedule", "track_payments", "reduce_no_shows", "save_admin_time"],
    suggestedNoticeHours: 24,
    serviceExamples: [],
  },
};

export const SEGMENT_LABEL: Record<Segment, string> = {
  beleza: "Beleza",
  personal: "Treino",
  outro: "Outros",
};

export function goalLabel(goal: OnboardingGoal, preset: ProfessionPreset): string {
  switch (goal) {
    case "fill_schedule":
      return "Ocupar horários vagos da agenda";
    case "organize_clients":
      return `Organizar meus ${preset.clientNoun.many}`;
    case "track_payments":
      return "Saber quem pagou e quem falta pagar";
    case "reduce_no_shows":
      return "Reduzir faltas e cancelamentos em cima da hora";
    case "save_admin_time":
      return "Gastar menos tempo com administração";
  }
}

/** Opções de antecedência (horas). O banco aceita 0–168. */
export const NOTICE_OPTIONS: readonly number[] = [0, 2, 4, 6, 12, 24, 48];

export function noticeLabel(hours: number): string {
  if (hours === 0) return "Pode cancelar até a hora marcada";
  if (hours < 24) return `Até ${hours} h antes`;
  const days = hours / 24;
  return days === 1 ? "Até 1 dia antes" : `Até ${days} dias antes`;
}

/** Multa opcional por cancelamento tardio, em % do preço combinado (bps no servidor). */
export const LATE_FEE_OPTIONS: readonly (number | null)[] = [null, 2500, 5000, 10_000];

export function lateFeeLabel(bps: number | null): string {
  return bps === null ? "Sem multa" : `${bps / 100}% do valor combinado`;
}

/** Fusos do Brasil (IANA). O servidor valida qualquer IANA; a lista evita erro de digitação. */
export const BRAZIL_TIMEZONES: readonly { id: string; label: string }[] = [
  { id: "America/Sao_Paulo", label: "Brasília (SP, RJ, MG, Sul, GO, DF, BA, NE)" },
  { id: "America/Manaus", label: "Amazonas (Manaus)" },
  { id: "America/Cuiaba", label: "Mato Grosso" },
  { id: "America/Campo_Grande", label: "Mato Grosso do Sul" },
  { id: "America/Belem", label: "Pará (Belém)" },
  { id: "America/Porto_Velho", label: "Rondônia" },
  { id: "America/Boa_Vista", label: "Roraima" },
  { id: "America/Rio_Branco", label: "Acre" },
  { id: "America/Noronha", label: "Fernando de Noronha" },
];

/**
 * Versões de termos e privacidade aceitas na criação do negócio. PROVISÓRIAS: o texto final
 * da política de privacidade é gate aberto do P00 e precisa existir antes de dados reais.
 */
export const POLICY_VERSIONS = {
  terms: "termos-piloto-v0",
  privacy: "privacidade-piloto-v0",
} as const;

/** Senha mínima no app. O config.toml local aceita 6; proposta ao integrador: 10. */
export const MIN_PASSWORD_LENGTH = 10;
