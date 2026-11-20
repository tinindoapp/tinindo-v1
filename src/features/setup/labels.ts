// Rótulos e utilitários da Configuração (P44). O catálogo dos passos (ordem, obrigatoriedade, rótulo, porquê e tela que
// resolve) está em src/lib/setup/steps.ts, compartilhado com o "Me ajuda a configurar" do Assistente; aqui entram os
// ícones da tela de Configuração. O servidor é a fonte do estado; aqui só a apresentação.
import type { SetupStepCode, WeeklyWindow } from "@contracts";
import type { IconName } from "../../components/ui/icons.tsx";
import { SETUP_STEPS, type SetupStepSpec } from "../../lib/setup/steps.ts";

export interface StepSpec extends SetupStepSpec {
  icon: IconName;
}

const STEP_ICON: Record<SetupStepCode, IconName> = {
  hours: "ajustes", service: "lista", cancellation_policy: "conta", profile: "perfil",
  first_customer: "cliente", photo_whatsapp: "perfil", channel: "mensagem", first_cash: "receber",
};

/**
 * P50: por que a antecedência para cancelar importa. O texto antigo prometia que a política "aparece para o cliente
 * antes de reservar" quando o link público ainda não a mostrava (revisão de 04/11, achado A3). O passo é obrigatório
 * porque o link público mostra a regra; o texto diz o que o dono define e onde o cliente vê. Desde o recado #115 o
 * catálogo comum (src/lib/setup/steps.ts) e app.setup_steps() (migration 20261120090000) têm o mesmo texto; a tela
 * continua sobrepondo até a migration valer em todo banco que ela lê.
 */
export const CANCELLATION_WHY = "Você define até quantas horas antes o cliente cancela sem custo. É a regra que o link público mostra a quem vai reservar.";

export const STEP_CATALOG: readonly StepSpec[] = SETUP_STEPS.map((s) => ({ ...s, why: s.step === "cancellation_policy" ? CANCELLATION_WHY : s.why, icon: STEP_ICON[s.step] }));

/** Porquê do passo como a tela mostra: o do servidor, menos no passo cujo texto o P50 corrigiu. null = passo feito. */
export const stepWhy = (s: { step: SetupStepCode; why: string | null }): string | null => (s.why === null ? null : s.step === "cancellation_policy" ? CANCELLATION_WHY : s.why);

export const specOf =(step: SetupStepCode): StepSpec => STEP_CATALOG.find((s) => s.step === step)!;

export const PROFESSION_LABEL = { barber: "Barbearia", hairdresser: "Cabeleireira(o)", personal_trainer: "Personal trainer", other: "Outra" } as const;

export function formatCents(cents: number): string {
  return `R$ ${(cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function priceRange(from: number | null, to: number | null): string | null {
  if (from === null || to === null) return null;
  return from === to ? formatCents(from) : `${formatCents(from)} a ${formatCents(to)}`;
}

const WEEKDAY_NAME = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

function daysText(days: readonly number[]): string {
  const names = days.map((d) => WEEKDAY_NAME[d]!);
  const consecutive = days.every((d, i) => i === 0 || d === days[i - 1]! + 1);
  return days.length === 7 ? "todos os dias" : consecutive && days.length > 2 ? `${names[0]} a ${names[names.length - 1]}` : names.join(", ");
}

/** "terça a sábado, 09:00 às 19:00"; com horários diferentes, um trecho por grupo de dias, separados por ponto e vírgula. */
export function summarizeHours(rules: readonly WeeklyWindow[]): string {
  if (rules.length === 0) return "sem expediente";
  const byDay = new Map<number, string[]>();
  for (const r of [...rules].sort((a, b) => a.weekday - b.weekday || a.local_start.localeCompare(b.local_start))) {
    byDay.set(r.weekday, [...(byDay.get(r.weekday) ?? []), `${r.local_start} às ${r.local_end}`]);
  }
  const bySchedule = new Map<string, number[]>();
  for (const [day, blocks] of byDay) bySchedule.set(blocks.join(" e "), [...(bySchedule.get(blocks.join(" e ")) ?? []), day]);
  return [...bySchedule.entries()].map(([schedule, days]) => `${daysText(days)}, ${schedule}`).join("; ");
}

export function explain(err: unknown): string {
  const e = err as { code?: string; field?: string } | null;
  switch (e?.code) {
    case "VALIDATION_ERROR":
      if (e.field === "name") return "Já existe um serviço ativo com esse nome. Nada foi criado.";
      if (e.field === "sentence") return "Escreva uma frase sobre o seu negócio (de 8 a 500 letras).";
      if (e.field === "step") return "Este passo é obrigatório e não pode ser dispensado.";
      if (e.field === "hours" || e.field === "rules") return "Confira os horários: o fim precisa vir depois do início e os blocos não podem se sobrepor. Nada foi salvo.";
      return "Confira os dados. Nada foi salvo.";
    case "STALE_VERSION":
      return "Isto mudou em outro lugar. Atualizamos a tela: confira e tente de novo.";
    case "IDEMPOTENCY_MISMATCH":
      return "Pedido repetido com dados diferentes. Nada novo foi gravado.";
    case "FORBIDDEN":
      return "Só o dono do negócio pode fazer isto.";
    case "NOT_FOUND":
      return "Não encontramos a agenda principal deste negócio.";
    default:
      return "Não foi possível concluir agora. Nada foi alterado por esta tentativa.";
  }
}
