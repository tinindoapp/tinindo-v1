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

export const STEP_CATALOG: readonly StepSpec[] = SETUP_STEPS.map((s) => ({ ...s, icon: STEP_ICON[s.step] }));

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

/** "ter a sáb, 09:00 às 19:00" a partir das janelas (resumo para a confirmação). */
export function summarizeHours(rules: readonly WeeklyWindow[]): string {
  if (rules.length === 0) return "sem expediente";
  const days = [...new Set(rules.map((r) => r.weekday))].sort((a, b) => a - b);
  const names = days.map((d) => WEEKDAY_NAME[d]!);
  const consecutive = days.every((d, i) => i === 0 || d === days[i - 1]! + 1);
  const dayText = days.length === 7 ? "todos os dias" : consecutive && days.length > 2 ? `${names[0]} a ${names[names.length - 1]}` : names.join(", ");
  const byDay = new Map<number, string[]>();
  for (const r of rules) byDay.set(r.weekday, [...(byDay.get(r.weekday) ?? []), `${r.local_start} às ${r.local_end}`]);
  const first = byDay.get(days[0]!)!.join(" e ");
  const same = days.every((d) => byDay.get(d)!.join(" e ") === first);
  return same ? `${dayText}, ${first}` : `${dayText}, horários diferentes por dia`;
}

export function explain(err: unknown): string {
  const e = err as { code?: string; field?: string } | null;
  switch (e?.code) {
    case "VALIDATION_ERROR":
      if (e.field === "name") return "Já existe um serviço ativo com esse nome. Nada foi criado.";
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
