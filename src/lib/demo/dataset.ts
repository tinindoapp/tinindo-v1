// BASE DE EXEMPLO ÚNICA da demonstração offline (auditoria de UX, item 47). Antes, Caixa, Pagamentos, Resultado, Metas e
// Assistente tinham cada um os seus números e a mesma semana mostrava valores diferentes em cada tela. Agora todos
// derivam daqui: atendimentos, recebimentos, despesas, valores a receber e o funil (lembretes, orçamentos, ofertas).
// Tudo fictício e rotulado como exemplo. Nada daqui é usado com servidor.
//
// Período coberto: 21/09/2026 a 22/10/2026 (fuso de São Paulo, sem horário de verão). "Agora" é FIXED_NOW (terça 20/10,
// 09:00). A semana de 19/10 é a mesma da Agenda (src/features/scheduling/demoData.ts).
import type { AnalyticsMetricsOutput, Booking, ExpenseCategory, Metric, PaymentRecord, TimeRange } from "@contracts";

type PaymentMethod = PaymentRecord["method"];
import { FIXED_NOW, FX } from "@contracts/fixtures.ts";
import { DEMO_BLOCKS, DEMO_WEEKLY_HOURS, demoBookings } from "../../features/scheduling/demoData.ts";

export const DEMO_TZ = "America/Sao_Paulo";
const OFFSET = "-03:00";
const DAY = 86_400_000;
const at = (date: string, time: string) => new Date(`${date}T${time}:00${OFFSET}`).toISOString();

export const DEMO_SERVICES = {
  [FX.services.corteA]: { name: "Corte", duration_min: 30, price_cents: 6000 },
  [FX.services.barbaA]: { name: "Barba", duration_min: 20, price_cents: 4000 },
} as Record<string, { name: string; duration_min: number; price_cents: number }>;

export const DEMO_PEOPLE = [
  { id: FX.customers.abInA, name: "Cliente Exemplo Ana" },
  { id: FX.customers.guestInA, name: "Cliente Exemplo Bruno" },
  { id: "30000000-0000-4000-8000-0000000000a3", name: "Maria Exemplo Silva" },
  { id: "30000000-0000-4000-8000-0000000000a4", name: "Maria Exemplo Souza" },
] as const;

export interface DemoVisit {
  id: string;
  customer_id: string | null;
  service_id: string;
  starts_at: string;
  ends_at: string;
  status: Booking["status"];
  agreed_price_cents: number | null;
  reminder_sent: boolean;
}
export interface DemoPayment {
  id: string;
  booking_id: string | null;
  customer_id: string | null;
  description: string;
  amount_cents: number;
  method: PaymentMethod;
  received_at: string;
}
export interface DemoExpense {
  id: string;
  amount_cents: number;
  paid_at: string;
  category: ExpenseCategory;
  description: string;
}
export interface DemoOpenReceivable {
  id: string;
  customer_id: string | null;
  description: string;
  amount_cents: number;
  due_at: string | null;
}

const uuid = (prefix: string, n: number) => `${prefix}-0000-4000-8000-${String(n).padStart(12, "0")}`;
const isoDate = (t: number) => new Date(t).toISOString().slice(0, 10);

/** Dias úteis do histórico (antes da semana da Agenda): 21/09 a 16/10. */
function historyDates(): string[] {
  const out: string[] = [];
  for (let t = Date.parse("2026-09-21T12:00:00Z"); t <= Date.parse("2026-10-16T12:00:00Z"); t += DAY) {
    const wd = new Date(t).getUTCDay();
    if (wd >= 1 && wd <= 5) out.push(isoDate(t));
  }
  return out;
}

/** Três atendimentos por dia útil, com faltas e cancelamentos espalhados de forma fixa (sempre os mesmos números). */
const SLOTS = [
  { time: "09:00", service: FX.services.corteA },
  { time: "10:00", service: FX.services.barbaA },
  { time: "15:00", service: FX.services.corteA },
] as const;

function build() {
  const visits: DemoVisit[] = [];
  const payments: DemoPayment[] = [];
  const methods: PaymentMethod[] = ["pix", "cash", "card"];
  historyDates().forEach((date, d) => {
    SLOTS.forEach((slot, s) => {
      const svc = DEMO_SERVICES[slot.service]!;
      const n = d * SLOTS.length + s + 1;
      const status: Booking["status"] = (d % 5 === 2 && s === 1) || (d % 4 === 1 && s === 2) ? "no_show" : d % 6 === 3 && s === 0 ? "cancelled" : "completed";
      const customer = DEMO_PEOPLE[(d + s) % DEMO_PEOPLE.length]!.id;
      const starts = at(date, slot.time);
      const ends = new Date(Date.parse(starts) + svc.duration_min * 60_000).toISOString();
      const id = uuid("6a000000", n);
      visits.push({ id, customer_id: customer, service_id: slot.service, starts_at: starts, ends_at: ends, status,
        agreed_price_cents: svc.price_cents, reminder_sent: (d + s) % 4 !== 0 });
      // Um concluído de setembro ficou sem cobrança (o Resultado de 28 dias mostra a cobertura). Em outubro, só os de
      // segunda 19/10 da Agenda estão sem cobrança: são os que o Caixa lista para cobrar.
      const uncharged = date < "2026-10-01" && d % 6 === 5 && s === 0;
      if (status === "completed" && !uncharged) {
        payments.push({ id: uuid("6b000000", n), booking_id: id, customer_id: customer, description: svc.name, amount_cents: svc.price_cents,
          method: methods[(d + s) % methods.length]!, received_at: ends });
      }
    });
  });
  // Semana da Agenda (19/10 em diante): os mesmos atendimentos que a Agenda mostra. Os concluídos de segunda 19/10
  // ficam SEM cobrança (o Caixa os lista para cobrar).
  for (const b of demoBookings()) {
    visits.push({ id: b.id, customer_id: b.customer_id, service_id: b.service_id, starts_at: b.starts_at, ends_at: b.ends_at, status: b.status,
      agreed_price_cents: b.agreed_price_cents, reminder_sent: b.customer_id !== null });
  }
  // Pacote de 4 cortes vendido e pago no dia 05/10 (não é atendimento: entra só no recebido).
  payments.push({ id: uuid("6b000000", 900), booking_id: null, customer_id: FX.customers.abInA, description: "Pacote 4 × Corte",
    amount_cents: 20000, method: "card", received_at: at("2026-10-05", "11:05") });
  visits.sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
  payments.sort((a, b) => Date.parse(a.received_at) - Date.parse(b.received_at));
  return { visits, payments };
}

const BUILT = build();

/** Atendimentos de exemplo (todos os estados), em ordem de início. */
export const demoVisits = (): DemoVisit[] => BUILT.visits.map((v) => ({ ...v }));
/** Recebimentos registrados (atendimentos pagos e o pacote). */
export const demoPayments = (): DemoPayment[] => BUILT.payments.map((p) => ({ ...p }));

export const DEMO_EXPENSES: readonly DemoExpense[] = [
  { id: uuid("6c000000", 1), amount_cents: 4500, paid_at: at("2026-09-28", "10:00"), category: "supplies", description: "Lâminas e toalhas" },
  { id: uuid("6c000000", 2), amount_cents: 30000, paid_at: at("2026-10-05", "10:00"), category: "rent", description: "Aluguel da cadeira" },
  { id: uuid("6c000000", 3), amount_cents: 1500, paid_at: at("2026-10-15", "10:00"), category: "supplies", description: "Lâminas" },
];

/** Valores em aberto (cobrança feita, ainda não paga). Os mesmos no Caixa ("A receber") e em Pagamentos. */
export const DEMO_OPEN_RECEIVABLES: readonly DemoOpenReceivable[] = [
  { id: uuid("6d000000", 1), customer_id: FX.customers.abInA, description: "Corte · Ana (exemplo)", amount_cents: 6000, due_at: at("2026-10-16", "12:00") },
  { id: uuid("6d000000", 2), customer_id: FX.customers.guestInA, description: "Barba · Bruno (exemplo)", amount_cents: 4000, due_at: at("2026-10-23", "12:00") },
  { id: uuid("6d000000", 3), customer_id: null, description: "Produto · pomada", amount_cents: 3098, due_at: null },
];

/** Funil fora da agenda: orçamentos com link e ofertas de vaga do período de exemplo (mesmos números em toda tela). */
export const DEMO_FUNNEL = { quotes_linked: 10, quotes_accepted: 7, waitlist_offers: 0, waitlist_accepted: 0 };

/** Concluídos sem cobrança registrada (até agora). O Caixa mostra estes para cobrar. */
export function demoUncharged(now: Date = demoNow()): DemoVisit[] {
  const paid = new Set(BUILT.payments.map((x) => x.booking_id));
  return BUILT.visits.filter((v) => v.status === "completed" && !paid.has(v.id) && Date.parse(v.starts_at) < now.getTime()).map((v) => ({ ...v }));
}

export const demoNow = () => new Date(FIXED_NOW);
const within = (iso: string, p: TimeRange) => Date.parse(iso) >= Date.parse(p.starts_at) && Date.parse(iso) < Date.parse(p.ends_at);

/** Minutos vendáveis (expediente menos bloqueios) por dia local entre as datas do período. */
function sellableMinutes(p: TimeRange): number {
  const min = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
  let total = 0;
  for (let t = Date.parse(p.starts_at); t < Date.parse(p.ends_at); t += DAY) {
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: DEMO_TZ }).format(new Date(t));
    const wd = new Date(`${date}T12:00:00Z`).getUTCDay();
    const open = (DEMO_WEEKLY_HOURS[wd]?.open ?? []).reduce((s, [a, b]) => s + min(b) - min(a), 0);
    const blocked = DEMO_BLOCKS.filter((b) => b.date === date).reduce((s, b) => s + min(b.to) - min(b.from), 0);
    total += open - blocked;
  }
  return total;
}

/** Contagens de um período, com as mesmas definições do banco (ver notas dos indicadores). */
export function demoCounts(p: TimeRange, now: Date = demoNow()) {
  const nowMs = now.getTime();
  const inP = BUILT.visits.filter((v) => within(v.starts_at, p));
  const past = inP.filter((v) => Date.parse(v.starts_at) < nowMs);
  const minutes = (v: DemoVisit) => (Date.parse(v.ends_at) - Date.parse(v.starts_at)) / 60_000;
  const done = past.filter((v) => v.status === "completed");
  const paidBookings = new Set(BUILT.payments.map((x) => x.booking_id));
  return {
    sellable: sellableMinutes(p),
    booked: inP.filter((v) => v.status === "confirmed" || v.status === "completed" || v.status === "no_show").reduce((s, v) => s + minutes(v), 0),
    done: done.length,
    noShow: past.filter((v) => v.status === "no_show").length,
    cancelled: past.filter((v) => v.status === "cancelled").length,
    charged: done.filter((v) => paidBookings.has(v.id)).length,
    pending: past.filter((v) => v.status === "confirmed").length,
    withCustomer: past.filter((v) => v.customer_id && v.status !== "cancelled").length,
    reminders: past.filter((v) => v.customer_id && v.status !== "cancelled" && v.reminder_sent).length,
    received: BUILT.payments.filter((x) => within(x.received_at, p) && Date.parse(x.received_at) <= nowMs).reduce((s, x) => s + x.amount_cents, 0),
    spent: DEMO_EXPENSES.filter((x) => within(x.paid_at, p) && Date.parse(x.paid_at) <= nowMs).reduce((s, x) => s + x.amount_cents, 0),
  };
}

const ratio = (num: number, den: number): Pick<Metric, "numerator" | "denominator" | "value" | "status"> =>
  ({ numerator: num, denominator: den, value: den === 0 ? null : Math.round((num / den) * 10_000) / 10_000, status: den === 0 ? "insufficient" : "ok" });

/** Indicadores do período como o Resultado e as Metas mostram (uma conta só para as duas telas). */
export function demoMetrics(p: TimeRange, now: Date = demoNow()): Pick<AnalyticsMetricsOutput, "metrics" | "coverage"> {
  const c = demoCounts(p, now);
  const m = (key: Metric["key"], label: string, unit: Metric["unit"], part: Pick<Metric, "numerator" | "denominator" | "value" | "status">, note: string): Metric =>
    ({ key, label, unit, note, ...part });
  const money = (v: number) => ({ numerator: v, denominator: null, value: v, status: "ok" as const });
  const metrics: Metric[] = [
    m("occupancy", "Ocupação", "ratio", ratio(c.booked, c.sellable), "Minutos reservados (confirmados, concluídos e faltas) dentro do expediente vendável (expediente menos bloqueios). Holds, cancelados e intervalos não contam."),
    m("no_show", "Faltas", "ratio", ratio(c.noShow, c.done + c.noShow), "Faltas sobre atendimentos com desfecho (concluídos + faltas) já ocorridos. Futuros, cancelados e sem desfecho ficam fora."),
    m("cancellation", "Cancelamentos", "ratio", ratio(c.cancelled, c.done + c.noShow + c.cancelled), "Cancelados sobre concluídos, faltas e cancelados com início no período, até agora."),
    m("waitlist_acceptance", "Ofertas de vaga aceitas", "ratio", ratio(DEMO_FUNNEL.waitlist_accepted, DEMO_FUNNEL.waitlist_offers), "Ofertas aceitas sobre ofertas preparadas. Aceitar não é comparecer nem pagar."),
    m("quote_acceptance", "Orçamentos aceitos", "ratio", ratio(DEMO_FUNNEL.quotes_accepted, DEMO_FUNNEL.quotes_linked), "Aceitos sobre orçamentos com link gerado no período (inclui ainda abertos e vencidos). Aceito não é pago."),
    m("received", "Recebimentos registrados", "cents", money(c.received), "Soma do que foi lançado como recebido, já descontados estornos. Não é lucro, saldo bancário nem receita causada pela Tinindo."),
    m("expenses", "Despesas registradas", "cents", money(c.spent), "Soma das despesas lançadas, já descontados estornos."),
    m("charge_coverage", "Atendimentos com cobrança registrada", "ratio", ratio(c.charged, c.done), "Concluídos com cobrança ou crédito de pacote lançado. Mede a qualidade do registro, não o recebimento."),
    m("human_minutes", "Minutos da equipe Tinindo", "minutes", { numerator: 0, denominator: null, value: 0, status: "ok" }, "Minutos humanos medidos em serviços assistidos. Automação: 0 min; retrabalho: 0 min."),
    m("reminders", "Lembretes enviados", "ratio", ratio(c.reminders, c.withCustomer), "Atendimentos com cliente que tiveram lembrete enviado ao canal ou compartilhado pelo profissional, sobre os atendimentos do período. Enviado não é entregue nem lido."),
  ];
  const coverage: AnalyticsMetricsOutput["coverage"] = [];
  if (Date.parse(p.ends_at) > now.getTime()) coverage.push({ key: "future", count: null, note: "O período inclui dias futuros: faltas e cancelamentos contam só até agora; ocupação inclui reservas futuras." });
  if (c.pending > 0) coverage.push({ key: "pending_outcome", count: c.pending, note: "Atendimentos já passados ainda como confirmados (sem concluir nem marcar falta): fora das taxas." });
  if (c.done - c.charged > 0) coverage.push({ key: "uncharged", count: c.done - c.charged, note: "Atendimentos concluídos sem cobrança registrada: os recebimentos podem estar incompletos." });
  return { metrics, coverage };
}

/** Início do mês corrente até o início de hoje, no fuso do negócio: o "mês" de Metas e de "Este mês" no Resultado. */
export function demoMonthToDate(now: Date = demoNow()): TimeRange {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: DEMO_TZ }).format(now);
  return { starts_at: at(`${day.slice(0, 7)}-01`, "00:00"), ends_at: at(day, "00:00") };
}
