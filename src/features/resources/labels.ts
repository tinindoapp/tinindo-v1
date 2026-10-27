// Textos do módulo Equipe. Dinheiro em centavos; horários no fuso do negócio; estado por palavra.
import type { TeamResource } from "@contracts";

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
export const formatCents = (c: number) => BRL.format(c / 100);
export const formatPercent = (bps: number) => `${(bps / 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
export const formatTime = (v: string, timeZone: string) => new Intl.DateTimeFormat("pt-BR", { timeZone, hour: "2-digit", minute: "2-digit" }).format(new Date(v));
export const formatDay = (v: string, timeZone: string) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone, weekday: "short", day: "2-digit", month: "2-digit" }).format(new Date(v));

export const KIND_LABEL: Record<TeamResource["kind"], string> = { professional: "Profissional", room: "Sala", chair: "Cadeira", equipment: "Equipamento" };
export const KIND_PLURAL: Record<TeamResource["kind"], string> = { professional: "Profissionais", room: "Salas", chair: "Cadeiras", equipment: "Equipamentos" };
export const BOOKING_STATUS = { confirmed: "Confirmada", completed: "Concluída", cancelled: "Cancelada" } as const;
export const CLASS_STATUS = { scheduled: "Agendada", completed: "Concluída", cancelled: "Cancelada" } as const;
export const SEAT_STATUS = { booked: "inscrita", cancelled: "vaga liberada", attended: "presente", no_show: "faltou" } as const;

/** Data local (YYYY-MM-DD) de um instante, no fuso do negócio. */
export function localDate(v: string, timeZone: string): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(v)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
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

export function explain(err: unknown): string {
  const e = err as { code?: string; field?: string } | null;
  switch (e?.code) {
    case "SLOT_CONFLICT":
      return `${CONFLICT[e.field ?? ""] ?? "Horário ocupado."} Nada foi reservado: nenhum recurso ficou preso.`;
    case "STALE_VERSION":
      return "Isto mudou em outro lugar. Atualizamos a tela: confira e tente de novo.";
    case "POLICY_REJECTED":
      if (e.field === "capacity") return "A turma está lotada.";
      if (e.field === "seat") return "Esta cliente já está na turma.";
      if (e.field === "starts_at") return "Só dá para concluir depois do horário de início.";
      if (e.field === "name") return "Já existe um recurso ativo com esse nome, ou outra profissional já está vinculada à sua agenda.";
      if (e.field === "active") return "Há reservas ou turmas futuras com este recurso. Cancele ou mude antes de desativar.";
      if (e.field === "reversed") return "Esta comissão já foi estornada.";
      if (e.field === "resource_ids") return "Um dos recursos está inativo.";
      return "As regras não permitem esta ação agora. Nada foi alterado.";
    case "VALIDATION_ERROR":
      if (e.field === "starts_at") return "Escolha um horário no futuro.";
      if (e.field === "resource_ids") return "Escolha uma profissional e recursos diferentes entre si (até 4).";
      if (e.field === "commission_bps") return "Comissão e vínculo com a agenda são só para profissionais.";
      return "Confira os campos e tente de novo.";
    case "NOT_FOUND":
      return "Não encontrado. A tela pode estar desatualizada.";
    case "FORBIDDEN":
      return "Só o dono do negócio administra a equipe.";
    default:
      return "Não foi possível concluir agora. Tentar de novo é seguro.";
  }
}
