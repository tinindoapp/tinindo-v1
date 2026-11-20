// Textos do módulo Equipe. Dinheiro em centavos; horários no fuso do negócio; estado por palavra.
import type { TeamResource } from "@contracts";

import { errorExplainer } from "../../lib/errors.ts";

export { formatCents } from "../../lib/money.ts";
export { formatTime, formatWeekdayDate as formatDay, localDate } from "../../lib/time.ts";
export const formatPercent = (bps: number) => `${(bps / 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
export const KIND_LABEL: Record<TeamResource["kind"], string> = { professional: "Profissional", room: "Sala", chair: "Cadeira", equipment: "Equipamento" };
export const KIND_PLURAL: Record<TeamResource["kind"], string> = { professional: "Profissionais", room: "Salas", chair: "Cadeiras", equipment: "Equipamentos" };
export const BOOKING_STATUS = { confirmed: "Confirmada", completed: "Concluída", cancelled: "Cancelada" } as const;
export const CLASS_STATUS = { scheduled: "Agendada", completed: "Concluída", cancelled: "Cancelada" } as const;
export const SEAT_STATUS = { booked: "inscrita", cancelled: "vaga liberada", attended: "presente", no_show: "faltou" } as const;
/** Meia-noite local de uma data (YYYY-MM-DD) como instante, achando o deslocamento do fuso naquele dia. */
export function localMidnight(date: string, timeZone: string): string {
  const guess = Date.parse(`${date}T12:00:00Z`);
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    .formatToParts(new Date(guess)).map((x) => [x.type, x.value]));
  const asLocal = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
  const offset = asLocal - guess;
  return new Date(Date.parse(`${date}T00:00:00Z`) - offset).toISOString().replace(/\.\d{3}Z$/, "Z");
}
/** Combina data e hora locais (HH:MM) num instante. */
export const localInstant = (date: string, hhmm: string, timeZone: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(Date.parse(localMidnight(date, timeZone)) + ((h ?? 0) * 60 + (m ?? 0)) * 60_000).toISOString().replace(/\.\d{3}Z$/, "Z");
};

const CONFLICT: Record<string, string> = {
  professional: "A profissional já tem atendimento nesse horário.",
  room: "A sala já está em uso nesse horário.",
  chair: "A cadeira já está em uso nesse horário.",
  equipment: "O equipamento já está em uso nesse horário.",
  agenda: "A sua agenda individual já tem compromisso nesse horário.",
  hours: "Fora do horário de funcionamento (o expediente da Agenda).",
  team: "A equipe já ocupa esse horário.",
};

export const explain = errorExplainer({
  SLOT_CONFLICT: (e) => `${CONFLICT[e.field ?? ""] ?? "Horário ocupado."} Nada foi reservado: nenhum recurso ficou preso.`,
  STALE_VERSION: "Isto mudou em outro lugar. Atualizamos a tela: confira e tente de novo.",
  "POLICY_REJECTED.capacity": "A turma está lotada.",
  "POLICY_REJECTED.seat": "Esta cliente já está na turma.",
  "POLICY_REJECTED.starts_at": "Só dá para concluir depois do horário de início.",
  "POLICY_REJECTED.name": "Já existe um recurso ativo com esse nome, ou outra profissional já está vinculada à sua agenda.",
  "POLICY_REJECTED.active": "Há reservas ou turmas futuras com este recurso. Cancele ou mude antes de desativar.",
  "POLICY_REJECTED.reversed": "Esta comissão já foi estornada.",
  "POLICY_REJECTED.resource_ids": "Um dos recursos está inativo.",
  POLICY_REJECTED: "As regras não permitem esta ação agora. Nada foi alterado.",
  "VALIDATION_ERROR.starts_at": "Escolha um horário no futuro.",
  "VALIDATION_ERROR.resource_ids": "Escolha uma profissional e recursos diferentes entre si (até 4).",
  "VALIDATION_ERROR.commission_bps": "Comissão e vínculo com a agenda são só para profissionais.",
  VALIDATION_ERROR: "Confira os campos e tente de novo.",
  NOT_FOUND: "Não encontrado. A tela pode estar desatualizada.",
  FORBIDDEN: "Só o dono do negócio administra a equipe.",
});
