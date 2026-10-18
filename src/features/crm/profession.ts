// Configuração adaptada por profissão: vocabulário e modelos de serviço para começar rápido.
// Modelos trazem só duração e intervalos; preço é sempre do profissional (sem sugestão de valor).
import type { Profession } from "@contracts";

export interface ServiceTemplate {
  name: string;
  duration_min: number;
  buffer_before_min: number;
  buffer_after_min: number;
}

export interface ProfessionConfig {
  customer: { one: string; many: string };
  templates: ServiceTemplate[];
  /** Dica sobre o intervalo (buffer) na tela de serviço. */
  bufferHint: string;
}

const GENERIC_HINT = "Intervalo é o tempo livre antes ou depois para preparar o espaço. Ele ocupa a agenda.";

export const PROFESSION_CONFIG: Record<Profession, ProfessionConfig> = {
  barber: {
    customer: { one: "cliente", many: "clientes" },
    templates: [
      { name: "Corte", duration_min: 30, buffer_before_min: 0, buffer_after_min: 10 },
      { name: "Barba", duration_min: 20, buffer_before_min: 0, buffer_after_min: 5 },
      { name: "Corte e barba", duration_min: 50, buffer_before_min: 0, buffer_after_min: 10 },
    ],
    bufferHint: "Use o intervalo depois para limpar a cadeira e as máquinas.",
  },
  hairdresser: {
    customer: { one: "cliente", many: "clientes" },
    templates: [
      { name: "Corte", duration_min: 45, buffer_before_min: 0, buffer_after_min: 10 },
      { name: "Escova", duration_min: 40, buffer_before_min: 0, buffer_after_min: 10 },
      { name: "Coloração", duration_min: 120, buffer_before_min: 0, buffer_after_min: 15 },
    ],
    bufferHint: "Serviços químicos costumam pedir intervalo maior depois.",
  },
  personal_trainer: {
    customer: { one: "aluno", many: "alunos" },
    templates: [
      { name: "Sessão de treino", duration_min: 60, buffer_before_min: 15, buffer_after_min: 15 },
      { name: "Avaliação física", duration_min: 45, buffer_before_min: 15, buffer_after_min: 15 },
    ],
    bufferHint: "Atendimento em outro endereço: inclua o deslocamento no intervalo antes e depois.",
  },
  other: {
    customer: { one: "cliente", many: "clientes" },
    templates: [{ name: "Atendimento", duration_min: 60, buffer_before_min: 0, buffer_after_min: 10 }],
    bufferHint: GENERIC_HINT,
  },
};
