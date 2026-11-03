// Rótulos e utilitários da Configuração (P44). O catálogo dos passos espelha app.setup_steps() da migration: a ordem,
// o que é obrigatório e a tela que resolve. O servidor é a fonte do estado; aqui só a apresentação.
import type { SetupStepCode, WeeklyWindow } from "@contracts";
import type { IconName } from "../../components/ui/icons.tsx";

export interface StepSpec {
  step: SetupStepCode;
  required: boolean;
  title: string;
  why: string;
  link: string;
  /** Verbo curto do botão ("Definir horários"). */
  cta: string;
  icon: IconName;
}

export const STEP_CATALOG: readonly StepSpec[] = [
  { step: "hours", required: true, title: "Definir seus horários de atendimento", why: "Sem expediente, o link público não mostra horários e ninguém consegue reservar.", link: "/app/agenda/horarios", cta: "Definir horários", icon: "ajustes" },
  { step: "service", required: true, title: "Cadastrar um serviço com duração e preço", why: "O cliente escolhe o serviço no link: a duração vira o horário e o preço vira o valor combinado.", link: "/app/clientes/servicos", cta: "Cadastrar serviço", icon: "lista" },
  { step: "cancellation_policy", required: true, title: "Definir a antecedência para cancelar", why: "A política aparece para o cliente antes de reservar e evita discussão depois.", link: "/app/conta", cta: "Definir antecedência", icon: "conta" },
  { step: "profile", required: true, title: "Publicar seu perfil e mandar o link", why: "O link público é como o cliente reserva com você. Sem ele, só por mensagem.", link: "/app/perfil", cta: "Publicar perfil", icon: "perfil" },
  { step: "first_customer", required: false, title: "Cadastrar seu primeiro cliente", why: "Com o cliente na lista, o atendimento já sai com nome e WhatsApp.", link: "/app/clientes", cta: "Cadastrar cliente", icon: "cliente" },
  { step: "photo_whatsapp", required: false, title: "Pôr foto e WhatsApp no perfil", why: "Foto e WhatsApp passam confiança a quem chega pelo link.", link: "/app/perfil", cta: "Pôr foto e WhatsApp", icon: "perfil" },
  { step: "channel", required: false, title: "Conectar e verificar seu número", why: "Com o número verificado, o código da reserva pelo link e os lembretes saem pelo canal.", link: "/app/mensagens", cta: "Conectar número", icon: "mensagem" },
  { step: "first_cash", required: false, title: "Registrar o primeiro recebimento", why: "O Caixa mostra o que entrou e o que falta cobrar a partir do primeiro registro.", link: "/app/caixa", cta: "Registrar recebimento", icon: "receber" },
];

export const specOf = (step: SetupStepCode): StepSpec => STEP_CATALOG.find((s) => s.step === step)!;

export const PROFESSION_LABEL = { barber: "Barbearia", hairdresser: "Cabeleireira(o)", personal_trainer: "Personal trainer", other: "Outra" } as const;

export function formatCents(cents: number): string {
  return `R$ ${(cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** "35", "35,00", "R$ 1.200,50" → centavos; inválido → null. */
export function parseCents(v: string): number | null {
  const t = v.replace(/R\$|\s|\./g, "").replace(",", ".");
  const n = Number(t);
  return /^\d+(\.\d{1,2})?$/.test(t) && Number.isFinite(n) ? Math.round(n * 100) : null;
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
