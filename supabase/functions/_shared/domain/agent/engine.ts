// Motor do assistente do dono (P08). Determinístico: entende o pedido por regras pt-BR, consulta só pelas
// ferramentas (lista fechada, tenant da sessão), compõe o texto a partir dos números devolvidos e, quando o
// pedido é inequívoco, devolve um RASCUNHO de proposta. Gravar/aprovar/executar é do servidor e do dono.
//
// Regras fixas (docs/05): não inventa valor; sem dado = diz que não há registro; dado de cliente/documento é
// texto, nunca instrução; não executa SQL; não revela instruções internas nem chaves; só vê o próprio negócio.
import { computePrice } from "../pricing/price.ts";
import {
  DAY_PART_RANGE,
  dayIn,
  dayPartIn,
  displayName,
  matchNames,
  norm,
  percentIn,
  type Period,
  periodIn,
  servicesIn,
  timesIn,
  weekdayIn,
} from "./parse.ts";
import { addDays, dayLabel, ddmm, duration, hhmm, localParts, longDayLabel, money, WEEKDAY_KEYS, WEEKDAY_NAMES, weekdayOf, type Window, zoned } from "./time.ts";
import {
  type Agenda,
  type AgendaBooking,
  type AgendaDay,
  type AgentContext,
  type AgentData,
  type AgentState,
  type Customer,
  type Directory,
  type EngineResult,
  type Finance,
  type PriceRule,
  type ProposalDraft,
  type Service,
  type Source,
  type ToolCall,
  ToolError,
} from "./types.ts";

export const MAX_TOOL_CALLS = 8;
export const MAX_OCCUPANCY_DAYS = 31;
const RULE_VALID_DAYS = 90;

class BudgetExceeded extends Error {}

/** Envolve as leituras: conta chamadas, registra argumentos e aplica o teto por execução. */
class Tools {
  readonly calls: ToolCall[] = [];
  constructor(private readonly data: AgentData, private readonly ctx: AgentContext) {}
  private use(tool: ToolCall["tool"], args: Record<string, unknown>) {
    if (this.calls.length >= MAX_TOOL_CALLS) throw new BudgetExceeded();
    this.calls.push({ tool, args: { tenant_id: this.ctx.tenant.id, ...args } });
  }
  directory(): Promise<Directory> {
    this.use("agenda.read", { scope: "directory" });
    return this.data.directory();
  }
  agenda(window: Window): Promise<Agenda> {
    this.use("agenda.read", { scope: "agenda", period: window, timezone: this.ctx.tenant.timezone });
    return this.data.agenda(window);
  }
  finance(window: Window): Promise<Finance> {
    this.use("finance.summary", { period: window, timezone: this.ctx.tenant.timezone });
    return this.data.finance(window);
  }
  propose(tool: ProposalDraft["tool"], payload: Record<string, unknown>) {
    this.use(tool, payload);
  }
}

// ----------------------------------------------------------------- intenções (texto normalizado)

const SECRET_RE = /\b(prompt|system prompt|instruc(ao|oes) (internas|do sistema|de sistema|secretas)|chaves? (de api|de acesso|secretas?|que voce usa)|api.?key|apikey|token|senhas?|segredos?|secret|service.?role|variave(l|is) de ambiente)\b/;
const SQL_RE = /\bselect\b[\s\S]*\bfrom\b|\b(drop|alter|create|truncate)\s+table\b|\bdelete\s+from\b|\binsert\s+into\b|\bupdate\s+\w+\s+set\b|\bsql\b/;
const FISCAL_RE = /\bnota fiscal\b|\bnfs-?e\b|\bnf-?e\b|\bcupom fiscal\b|\bemit\w* (a |uma )?nota\b/;
const MONEY_RE = /\b(transfer\w*|faz(er)? (um |o )?pix|mand\w* (um |o )?pix|pag(a|ar|ue) (o|a|os|as) (fornecedor\w*|contas?|boletos?)|estorn\w*)\b/;
const SEND_RE = /\b(envi\w*|mand\w*|dispar\w*)\b.*\b(mensage\w*|whats\w*|sms|e-?mails?|promoc\w*|lembretes?|avisos?)\b/;
const CROSS_RE = /\b(outr[oa]s? (negocios?|profissiona\w*|estabelecimentos?|saloes?|salao|barbearias?|empresas?|contas?|unidades?|personal\w*)|todos os negocios|tambem (treina|atende|corta|faz)|\bla\b.*\b(sess\w*|saldo|pacotes?|creditos?))/;
const ESCALATION_RE = /\b(voce e (o )?admin|modo (admin|desenvolvedor|depuracao)|ignor\w* (as |suas |todas as )?(regras|instruc\w*)|sem (me )?pedir aprovacao|nao precisa (me )?pedir)/;

const CANCEL_RE = /\b(cancel(a|e|ar|em)|desmarc\w*)\b/;
const RESCHEDULE_RE = /\b(remarc\w*|reagend\w*|adiant\w*|empurr\w*|(muda|mudar|troca|trocar) (o |de )?horario)\b/;
const CREATE_RE = /\b(marc(a|ar|e)|agendar|agende|encaix(a|ar|e)|reserv(ar|e))\b|^(por favor,? )?(agenda|reserva)\b/;
const DISCOUNT_RE = /\b(desconto|promoc\w*|promocional|mais barato)\b/;
const DISCOUNT_VERB_RE = /\b(aplic\w*|da|de|dar|cri(a|e|ar)|coloc\w*|bot\w*|lanc\w*|ativ\w*|quero|faz|fazer|faca)\b/;
const ADVICE_RE = /\b(pensar|ideias?|sugest\w*|sugere|ajuda)\b/;

const POLICY_RE = /\b(politica|regras?) de (cancelamento|cancelar|faltas?|atrasos?)\b|\bcancelamento\b/;
const WAITLIST_RE = /\b(lista|fila) de espera\b/;
const PACKAGE_RE = /\bpacotes?\b|\bcreditos?\b|\bsess(ao|oes) (restantes?|ainda)/;
const MARGIN_RE = /\bmargem\b|\blucro\b/;
const WITHDRAW_RE = /\b(retirar|tirar|sacar|pro-?labore|meu salario)\b/;
const RECEIVABLE_RE = /\ba receber\b|\bfalta receber\b|\bme devem\b|\bem aberto\b|\bpendentes?\b|\bquem (me )?deve\b/;
const SPENT_RE = /\b(gastei|gastos?|despesas?|paguei)\b/;
const RECEIVED_RE = /\b(recebi|entrou|faturei|faturamento|receita|ganhei|vendi|recebido)\b/;
const CUSTOMERS_RE = /\b(quantos|quais|meus|lista( de)?) clientes\b|\bclientes\b.*\b(instagram|whatsapp|google|indicac\w*|origem|vieram|veio|comec\w*|cadastrad\w*)\b/;
const NEXT_RE = /\bproxim[oa] (cliente|atendimento|horario|compromisso)\b/;
const OCC_RE = /\bocupa(cao|da|do)\b|\blotad[oa]\b|\bcheia\b|\bvazia\b/;
const FREE_RE = /\b(horarios?|vagas?|espacos?|tempo) (livres?|disponive\w*|vagos?)\b|\btenho horario\b|\bestou livre\b|\bhorario livre\b/;
const AGENDA_RE = /\b(o que tenho|que tenho|minha agenda|a agenda|agenda d\w*|atendimentos?|quem vem|marcados?|compromissos?|tenho (hoje|amanha))\b/;
const TEMPORAL_WORDS = /\b(semana|dia|mes|ano|hoje|amanha|manha|tarde|noite|segunda|terca|quarta|quinta|sexta|sabado|domingo|dessa|desta|essa|esta|proxima|passada)\b.*$/;

const SOURCE_WORDS: [RegExp, string, string][] = [
  [/\binstagram\b/, "instagram", "Instagram"],
  [/\bwhats\w*\b/, "whatsapp", "WhatsApp"],
  [/\bgoogle\b/, "google", "Google"],
  [/\bindicac\w*\b/, "referral", "indicação"],
  [/\bcondominio\b/, "condominium", "condomínio"],
  [/\b(passou na porta|porta|rua)\b/, "walk_in", "passou na porta"],
];

// ----------------------------------------------------------------- utilitários de intervalo

type Iv = [number, number];
const iv = (w: Window): Iv => [Date.parse(w.starts_at), Date.parse(w.ends_at)];
const iso = (ms: number) => new Date(ms).toISOString().replace(".000Z", "Z");

function subtract(base: Iv[], busy: Iv[]): Iv[] {
  let out = base.map((x) => [...x] as Iv);
  for (const [bs, be] of busy) {
    const next: Iv[] = [];
    for (const [s, e] of out) {
      if (be <= s || bs >= e) next.push([s, e]);
      else {
        if (bs > s) next.push([s, bs]);
        if (be < e) next.push([be, e]);
      }
    }
    out = next;
  }
  return out.filter(([s, e]) => e > s);
}

const ACTIVE = new Set(["held", "confirmed"]);
const SERVED = new Set(["confirmed", "completed"]);

function busyOf(agenda: Agenda, day: AgendaDay | undefined, exceptId?: string): Iv[] {
  const busy = agenda.bookings.filter((b) => ACTIVE.has(b.status) && b.id !== exceptId).map((b) => iv(b.occupied));
  for (const k of day?.blocks ?? []) busy.push(iv(k.range));
  return busy;
}

function freeWindows(agenda: Agenda, date: string, tz: string, now: Date, range?: [string, string], exceptId?: string): Iv[] {
  const day = agenda.days.find((d) => d.date === date);
  let open = (day?.open ?? []).map(iv);
  if (range) {
    const lo = zoned(date, range[0], tz).getTime();
    const hi = range[1] === "24:00" ? zoned(addDays(date, 1), "00:00", tz).getTime() : zoned(date, range[1], tz).getTime();
    open = open.map(([s, e]) => [Math.max(s, lo), Math.min(e, hi)] as Iv).filter(([s, e]) => e > s);
  }
  open = open.map(([s, e]) => [Math.max(s, now.getTime()), e] as Iv).filter(([s, e]) => e > s);
  return subtract(open, busyOf(agenda, day, exceptId));
}

/** O serviço cabe começando em `start`? (expediente, buffers, reservas e bloqueios). */
function fits(agenda: Agenda, date: string, now: Date, svc: Service, start: number, exceptId?: string): boolean {
  if (start <= now.getTime()) return false;
  const day = agenda.days.find((d) => d.date === date);
  const end = start + svc.duration_min * 60_000;
  const inOpen = (day?.open ?? []).map(iv).some(([s, e]) => start >= s && end <= e);
  if (!inOpen) return false;
  const occ: Iv = [start - svc.buffer_before_min * 60_000, end + svc.buffer_after_min * 60_000];
  return !busyOf(agenda, day, exceptId).some(([s, e]) => occ[0] < e && occ[1] > s);
}

/** Inícios possíveis do serviço numa janela livre, em sequência (duração + buffers). */
function startsIn(windows: Iv[], svc: Service, from = 0, limit = 5): number[] {
  const step = (svc.duration_min + svc.buffer_before_min + svc.buffer_after_min) * 60_000;
  const out: number[] = [];
  for (const [s, e] of windows) {
    for (let t = Math.max(s + svc.buffer_before_min * 60_000, from); t + (svc.duration_min + svc.buffer_after_min) * 60_000 <= e; t += step) {
      out.push(t);
      if (out.length >= limit) return out;
    }
  }
  return out;
}

const floor15 = (ms: number) => Math.floor(ms / 900_000) * 900_000;

// ----------------------------------------------------------------- preço

function ruleFor(rules: PriceRule[], svc: Service, start: Date, tz: string): PriceRule | null {
  const p = localParts(start, tz);
  return rules.find((r) => r.service_id === svc.id
    && Date.parse(r.valid.starts_at) <= start.getTime() && start.getTime() < Date.parse(r.valid.ends_at)
    && r.windows.some((w) => w.weekday === p.weekday && p.time >= w.local_start && p.time < w.local_end)) ?? null;
}

function priceAt(rules: PriceRule[], svc: Service, start: Date, tz: string): { cents: number; rule: PriceRule | null } {
  const rule = ruleFor(rules, svc, start, tz);
  if (!rule) return { cents: svc.base_price_cents, rule: null };
  const r = computePrice({
    base_cents: svc.base_price_cents, manual_floor_cents: svc.min_price_cents, estimated_cost_cents: svc.estimated_cost_cents,
    fee_bps: svc.fee_bps, target_margin_bps: rule.target_margin_bps, discount_bps: rule.discount_bps, max_discount_bps: rule.max_discount_bps,
  });
  return r.ok ? { cents: r.final_cents, rule } : { cents: svc.base_price_cents, rule: null };
}

// ----------------------------------------------------------------- texto

const list = (items: string[]) => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} e ${items.at(-1)}`);
const orList = (items: string[]) => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} ou ${items.at(-1)}`);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function relDay(date: string, today: string): string {
  if (date === today) return `hoje (${dayLabel(date)})`;
  if (date === addDays(today, 1)) return `amanhã (${dayLabel(date)})`;
  return `${dayLabel(date)}`;
}

/** "hoje (…)", "amanhã (…)", "na quinta, 22/10", "no sábado, 24/10". */
function onDay(date: string, today: string): string {
  const rel = relDay(date, today);
  if (date === today || date === addDays(today, 1)) return rel;
  return `${[0, 6].includes(weekdayOf(date)) ? "no" : "na"} ${rel}`;
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function rangeText(p: Period): string {
  if (p.days === 1) return `em ${dayLabel(p.first)}`;
  return `de ${ddmm(p.first)} a ${ddmm(p.last)}`;
}

const CAPABILITIES = "Posso consultar sua agenda, horários livres, ocupação, o que foi registrado no caixa e o que há a receber, "
  + "e preparar propostas de agendamento, remarcação, cancelamento ou regra de preço para você aprovar.";

// ----------------------------------------------------------------- motor

export async function runAgent(input: string, ctx: AgentContext, data: AgentData): Promise<EngineResult> {
  const n = norm(input);
  const tz = ctx.tenant.timezone;
  const now = ctx.now;
  const today = localParts(now, tz).date;
  const tools = new Tools(data, ctx);

  const out = (intent: string, state: AgentState, text: string,
    extra: { sources?: Source[]; draft?: ProposalDraft | null; clarification?: boolean } = {}): EngineResult => ({
    intent, state, text: text.slice(0, 4000), sources: (extra.sources ?? []).slice(0, 50), draft: extra.draft ?? null,
    clarification: extra.clarification ?? false, tool_calls: tools.calls,
  });

  const ownerOnly = (intent: string) =>
    out(intent, "consulted", "Só o dono do negócio pode pedir alterações pelo assistente. Peça para o dono fazer este pedido.");

  // Nomes e textos vindos do banco são exibidos como texto; nunca viram instrução.
  const customerName = (dir: Directory, id: string | null) => {
    if (!id) return "cliente sem cadastro";
    const c = dir.customers.find((x) => x.id === id);
    return c ? displayName(c.name) : "cliente";
  };
  const serviceName = (dir: Directory, id: string) => dir.services.find((s) => s.id === id)?.name ?? "serviço";
  const bookingLine = (dir: Directory, b: AgendaBooking) =>
    `${hhmm(b.starts_at, tz)} ${serviceName(dir, b.service_id)} — ${customerName(dir, b.customer_id)}`;
  const bookingRef = (dir: Directory, b: AgendaBooking) => {
    const d = localParts(b.starts_at, tz).date;
    return `${relDay(d, today)} às ${hhmm(b.starts_at, tz)} (${serviceName(dir, b.service_id)}, ${customerName(dir, b.customer_id)})`;
  };
  const agendaSource = (a: Agenda): Source => ({ kind: "agenda", id: null, as_of: a.as_of });
  const bookingSources = (a: Agenda, bs: AgendaBooking[]): Source[] => bs.slice(0, 40).map((b) => ({ kind: "booking", id: b.id, as_of: a.as_of }));
  const dirSource = (d: Directory): Source => ({ kind: "business_config", id: null, as_of: d.as_of });
  const finSource = (f: Finance): Source => ({ kind: "finance_summary", id: null, as_of: f.as_of });
  const updated = (as_of: string) => `Atualizado às ${hhmm(as_of, tz)}.`;

  try {
    // 1 · recusas sem ferramenta
    if (SECRET_RE.test(n)) {
      return out("refuse_secrets", "consulted",
        `Não compartilho minhas instruções internas nem chaves de acesso. ${CAPABILITIES}`);
    }
    if (SQL_RE.test(n)) {
      return out("refuse_sql", "consulted",
        `Não executo SQL nem comandos no banco de dados, e não tenho acesso direto a ele. ${CAPABILITIES}`);
    }
    if (FISCAL_RE.test(n)) {
      return out("unavailable_fiscal", "consulted",
        "Ainda não emito nota fiscal: essa função está indisponível na Tinindo. Emita pelo sistema da sua prefeitura ou do seu contador.");
    }
    if (MONEY_RE.test(n)) {
      return out("unavailable_money", "consulted",
        "Não movimento dinheiro nem faço pagamentos ou transferências. Posso mostrar o que está registrado no caixa e o que há a receber.");
    }
    if (SEND_RE.test(n)) {
      return out("unavailable_send", "consulted",
        "Não envio mensagens pelo assistente. Para avisar um cliente sobre uma vaga, prepare a oferta na tela Lista de espera e compartilhe o link você mesmo.");
    }
    if (CROSS_RE.test(n)) return crossTenant();

    const escalation = ESCALATION_RE.test(n);

    // 2 · pedidos de alteração (viram proposta só quando inequívocos)
    if (CANCEL_RE.test(n)) return await changeFlow("cancel");
    if (RESCHEDULE_RE.test(n)) return await changeFlow("reschedule");
    if (DISCOUNT_RE.test(n) && !ADVICE_RE.test(n) && (percentIn(n) !== null || DISCOUNT_VERB_RE.test(n))) return await pricingFlow(escalation);
    if (CREATE_RE.test(n)) return await createFlow();

    // 3 · consultas
    if (POLICY_RE.test(n)) return await policyFlow();
    if (WAITLIST_RE.test(n)) return await waitlistFlow();
    if (PACKAGE_RE.test(n)) return await packageFlow();
    if (MARGIN_RE.test(n)) return await marginFlow();
    if (WITHDRAW_RE.test(n)) return await withdrawFlow();
    if (RECEIVABLE_RE.test(n)) return await receivableFlow();
    if (SPENT_RE.test(n)) return await spentFlow();
    if (RECEIVED_RE.test(n)) return await receivedFlow();
    if (CUSTOMERS_RE.test(n)) return await customersFlow();
    if (NEXT_RE.test(n)) return await nextFlow();
    if (OCC_RE.test(n)) return await occupancyFlow();
    if (FREE_RE.test(n)) return await freeFlow();
    if (DISCOUNT_RE.test(n)) return await promoAdviceFlow();
    if (AGENDA_RE.test(n)) return await agendaFlow();
    return out("unknown", "consulted", `Não entendi o pedido. ${CAPABILITIES}`, { clarification: true });
  } catch (e) {
    if (e instanceof BudgetExceeded) {
      return out("budget", "consulted",
        "Este pedido passou do limite de consultas por pergunta. A resposta ficaria parcial: peça um período menor ou um resumo.");
    }
    if (e instanceof ToolError && e.code === "FORBIDDEN") {
      return out("forbidden", "consulted", "Você não tem permissão para ver esses dados neste negócio. Só o dono vê o financeiro e a lista de espera.");
    }
    throw e;
  }

  // ----------------------------------------------------------------- recusas

  function crossTenant(): EngineResult {
    return out("refuse_cross_tenant", "consulted",
      `Só vejo os dados do seu negócio (${ctx.tenant.name}); não tenho acesso a outros negócios ou profissionais, nem posso dizer se alguém é cliente em outro lugar.`);
  }

  // ----------------------------------------------------------------- agenda

  async function agendaFlow(): Promise<EngineResult> {
    const period = periodIn(n, now, tz) ?? periodIn("hoje", now, tz)!;
    const dir = await tools.directory();
    // "agenda do <nome>": se não é cliente deste negócio, é pedido de outro negócio.
    const who = /\b(?:agenda|horarios?|clientes) d[oa]s? ([a-z0-9 ]{3,60})/.exec(n)?.[1]?.replace(TEMPORAL_WORDS, "").trim();
    if (who && who.length >= 3 && !norm(ctx.tenant.name).includes(who)) {
      const m = matchNames(who, dir.customers);
      if (m.exact.length + m.partial.length === 0) return crossTenant();
    }
    if (period.days > 62) {
      return out("agenda_limit", "consulted", "Consigo listar a agenda de até 62 dias por pergunta. Peça um período menor.");
    }
    const agenda = await tools.agenda(period.window);
    const served = agenda.bookings.filter((b) => SERVED.has(b.status));
    const held = agenda.bookings.filter((b) => b.status === "held");
    const total = served.reduce((s, b) => s + (b.agreed_price_cents ?? 0), 0);
    const sources = [agendaSource(agenda), ...bookingSources(agenda, [...served, ...held])];

    const coverageNote = "Considera só os registros lançados na Tinindo.";
    if (period.days === 1) {
      const d = period.first;
      const head = d === today ? `Hoje (${longDayLabel(d)})` : d === addDays(today, 1) ? `Amanhã (${longDayLabel(d)})` : cap(longDayLabel(d));
      if (served.length === 0 && held.length === 0) {
        return out("agenda", "consulted", `${head} você não tem nenhum atendimento marcado. ${coverageNote} ${updated(agenda.as_of)}`, { sources });
      }
      const lines = served.map((b) => `• ${bookingLine(dir, b)}${b.agreed_price_cents !== null ? ` · ${money(b.agreed_price_cents)}` : ""}`);
      let text = served.length
        ? `${head} você tem ${plural(served.length, "atendimento confirmado", "atendimentos confirmados")}, somando ${money(total)} em valores combinados:\n${lines.join("\n")}`
        : `${head} você não tem atendimento confirmado.`;
      if (held.length) {
        text += `\n${held.length === 1 ? "Há também 1 reserva provisória" : `Há também ${held.length} reservas provisórias`} (ainda não confirmada, sem valor combinado e fora da soma): ${held.map((b) => `${hhmm(b.starts_at, tz)} ${serviceName(dir, b.service_id)}`).join(", ")}.`;
      }
      return out("agenda", "consulted", `${text}\n${coverageNote} ${updated(agenda.as_of)}`, { sources });
    }
    const byDay = new Map<string, AgendaBooking[]>();
    for (const b of served) {
      const d = localParts(b.starts_at, tz).date;
      byDay.set(d, [...(byDay.get(d) ?? []), b]);
    }
    const lines = [...byDay.entries()].map(([d, bs]) => `• ${dayLabel(d)}: ${plural(bs.length, "atendimento", "atendimentos")} (${bs.map((b) => hhmm(b.starts_at, tz)).join(", ")})`);
    const text = served.length
      ? `${cap(rangeText(period))}: ${plural(served.length, "atendimento confirmado", "atendimentos confirmados")}, somando ${money(total)} em valores combinados.\n${lines.join("\n")}`
      : `${cap(rangeText(period))} você não tem nenhum atendimento confirmado.`;
    const heldNote = held.length ? `\n${plural(held.length, "reserva provisória", "reservas provisórias")} fora da soma.` : "";
    return out("agenda", "consulted", `${text}${heldNote}\n${coverageNote} ${updated(agenda.as_of)}`, { sources });
  }

  async function nextFlow(): Promise<EngineResult> {
    const dir = await tools.directory();
    const agenda = await tools.agenda({ starts_at: now.toISOString(), ends_at: new Date(now.getTime() + 7 * 86_400_000).toISOString() });
    const next = agenda.bookings.filter((b) => ACTIVE.has(b.status) && Date.parse(b.starts_at) > now.getTime())
      .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))[0];
    if (!next) {
      return out("next", "consulted", `Você não tem atendimento marcado nos próximos 7 dias. ${updated(agenda.as_of)}`,
        { sources: [agendaSource(agenda)] });
    }
    const d = localParts(next.starts_at, tz).date;
    const held = next.status === "held" ? " (reserva provisória, ainda não confirmada)" : "";
    return out("next", "consulted",
      `Seu próximo atendimento é ${relDay(d, today)} às ${hhmm(next.starts_at, tz)}: ${serviceName(dir, next.service_id)} com ${customerName(dir, next.customer_id)}${held}. ${updated(agenda.as_of)}`,
      { sources: [agendaSource(agenda), ...bookingSources(agenda, [next])] });
  }

  async function occupancyFlow(): Promise<EngineResult> {
    const period = periodIn(n, now, tz) ?? periodIn("hoje", now, tz)!;
    if (period.days > MAX_OCCUPANCY_DAYS) {
      return out("occupancy_limit", "consulted",
        `Consigo calcular a ocupação de até ${MAX_OCCUPANCY_DAYS} dias por pergunta, em resumo. Peça um período menor, como "ocupação desta semana" ou "ocupação de setembro".`);
    }
    const agenda = await tools.agenda(period.window);
    let sellable = 0;
    let served = 0;
    let heldMin = 0;
    for (const day of agenda.days) {
      const open = day.open.map(iv);
      const minutes = (xs: Iv[]) => xs.reduce((s, [a, b]) => s + (b - a) / 60_000, 0);
      sellable += minutes(subtract(open, day.blocks.map((k) => iv(k.range))));
    }
    for (const b of agenda.bookings) {
      const m = (Date.parse(b.ends_at) - Date.parse(b.starts_at)) / 60_000;
      if (SERVED.has(b.status)) served += m;
      if (b.status === "held") heldMin += m;
    }
    const where = period.days === 1 ? relDay(period.first, today) : rangeText(period);
    if (sellable === 0) {
      return out("occupancy", "consulted", `Não há expediente cadastrado ${period.days === 1 ? "para" : ""} ${where}, então não há ocupação a calcular.`,
        { sources: [agendaSource(agenda)] });
    }
    const pct = Math.round((served / sellable) * 100);
    let text = `A ocupação ${period.days === 1 ? "de" : ""} ${where} é de ${pct}%: ${duration(served)} em atendimentos confirmados de ${duration(sellable)} de expediente.`;
    if (heldMin > 0) text += ` Reservas provisórias (${duration(heldMin)}) não entram na conta porque ainda não foram confirmadas.`;
    return out("occupancy", "consulted", `${text.replace(/\s+/g, " ")} ${updated(agenda.as_of)}`, { sources: [agendaSource(agenda)] });
  }

  async function freeFlow(): Promise<EngineResult> {
    const date = dayIn(n, today) ?? today;
    const part = dayPartIn(n);
    const dir = await tools.directory();
    const svcs = servicesIn(n, dir.services);
    const svc = svcs.length === 1 ? svcs[0] : undefined;
    const agenda = await tools.agenda({ starts_at: zoned(date, "00:00", tz).toISOString(), ends_at: zoned(addDays(date, 1), "00:00", tz).toISOString() });
    const windows = freeWindows(agenda, date, tz, now, part ? DAY_PART_RANGE[part] : undefined);
    const where = `${cap(relDay(date, today))}${part ? ` ${part === "manha" ? "de manhã" : part === "tarde" ? "à tarde" : "à noite"}` : ""}`;
    const usable = svc
      ? windows.filter(([s, e]) => e - s >= (svc.duration_min + svc.buffer_before_min + svc.buffer_after_min) * 60_000)
      : windows;
    if (usable.length === 0) {
      return out("free", "consulted", `${where} você não tem horário livre${svc ? ` para ${svc.name}` : ""}. ${updated(agenda.as_of)}`,
        { sources: [agendaSource(agenda)] });
    }
    const parts = usable.map(([s, e]) => {
      const base = `das ${hhmm(iso(s), tz)} às ${hhmm(iso(e), tz)}`;
      if (!svc) return base;
      const last = floor15(e - (svc.duration_min + svc.buffer_after_min) * 60_000);
      return `${base} (último início às ${hhmm(iso(last), tz)})`;
    });
    let text = `${where} você tem horário livre${svc ? ` para ${svc.name}` : ""}: ${list(parts)}.`;
    if (svc) {
      const prices = new Map<number, string[]>();
      for (const [s] of usable) {
        const p = priceAt(dir.pricing_rules, svc, new Date(s), tz);
        prices.set(p.cents, [...(prices.get(p.cents) ?? []), hhmm(iso(s), tz)]);
      }
      const rule = dir.pricing_rules.find((r) => r.service_id === svc.id && r.windows.some((w) => w.weekday === localParts(zoned(date, "12:00", tz), tz).weekday));
      const ruleWin = rule?.windows.find((w) => w.weekday === localParts(zoned(date, "12:00", tz), tz).weekday);
      if (rule && ruleWin) {
        const p = priceAt(dir.pricing_rules, svc, zoned(date, ruleWin.local_start, tz), tz);
        text += ` Com a regra de preço ativa (das ${ruleWin.local_start} às ${ruleWin.local_end}), ${svc.name} sai por ${money(p.cents)}; fora dela, ${money(svc.base_price_cents)}.`;
      } else {
        text += ` ${svc.name}: ${money(svc.base_price_cents)} (preço base).`;
      }
    }
    text += " Ver horário livre não segura a vaga; para marcar, diga o cliente e o horário.";
    return out("free", "consulted", `${text} ${updated(agenda.as_of)}`, { sources: [agendaSource(agenda), dirSource(dir)] });
  }

  async function promoAdviceFlow(): Promise<EngineResult> {
    const date = dayIn(n, today);
    const dir = await tools.directory();
    const floors = dir.services.map((s) => `${s.name} ${money(s.min_price_cents)}`);
    if (!date) {
      return out("promo_advice", "recommendation",
        `Uma promoção costuma funcionar melhor nos horários mais vazios. Diga o dia (por exemplo, "promoção pra quinta") e eu mostro a ocupação. O piso de cada serviço sempre vale: ${list(floors)}.`,
        { sources: [dirSource(dir)] });
    }
    const agenda = await tools.agenda({ starts_at: zoned(date, "00:00", tz).toISOString(), ends_at: zoned(addDays(date, 1), "00:00", tz).toISOString() });
    const windows = freeWindows(agenda, date, tz, now);
    const freeTxt = windows.length ? list(windows.map(([s, e]) => `das ${hhmm(iso(s), tz)} às ${hhmm(iso(e), tz)}`)) : "nenhum horário";
    return out("promo_advice", "recommendation",
      `Em ${dayLabel(date)} você tem livre: ${freeTxt}. Uma ideia é um desconto só nesses horários, respeitando o piso de cada serviço (${list(floors)}). `
        + `Se quiser, peça por exemplo "aplica 15% de desconto ${WEEKDAY_NAMES[localParts(zoned(date, "12:00", tz), tz).weekday]} das 13h às 17h" e eu preparo a proposta para você aprovar. ${updated(agenda.as_of)}`,
      { sources: [agendaSource(agenda), dirSource(dir)] });
  }

  // ----------------------------------------------------------------- financeiro

  async function receivedFlow(): Promise<EngineResult> {
    const p = periodIn(n, now, tz) ?? periodIn("este mes", now, tz)!;
    const f = await tools.finance(p.window);
    const where = p.label === `${today.slice(0, 4)}` ? `Em ${p.label} (${rangeText(p)})` : cap(rangeText(p));
    let text = f.payments_count === 0
      ? `${where}: não há nenhum registro de recebimento.`
      : `${where}: você recebeu ${money(f.received_cents)} em ${plural(f.payments_count, "pagamento registrado", "pagamentos registrados")}.`;
    text += ` Só considera o que foi registrado na Tinindo (${plural(f.records_count, "registro", "registros")} no período); não inclui valores a receber nem saldo do banco.`;
    text += coverage(f, p);
    return out("finance_received", "consulted", `${text} ${updated(f.as_of)}`, { sources: [finSource(f)] });
  }

  function coverage(f: Finance, p: Period): string {
    if (!f.first_record_at) return " Ainda não há nenhum registro financeiro na Tinindo.";
    const first = localParts(f.first_record_at, tz).date;
    if (first > p.first) return ` Os registros só começam em ${ddmm(first)}: o valor cobre apenas desde ${ddmm(first)}, não o período inteiro.`;
    return "";
  }

  async function spentFlow(): Promise<EngineResult> {
    const p = periodIn(n, now, tz) ?? periodIn("este mes", now, tz)!;
    const f = await tools.finance(p.window);
    const supplies = /\b(produtos?|materia(l|is)|insumos?)\b/.test(n);
    const cents = supplies ? f.supplies_cents : f.spent_cents;
    const count = supplies ? f.supplies_count : f.expenses_count;
    const what = supplies ? "gasto com produtos" : "gasto";
    const where = p.label && p.days > 1 && !/^(últimos|esta|semana)/.test(p.label) ? `em ${p.label} (${rangeText(p)})` : rangeText(p);
    const text = count === 0
      ? `Não há nenhum registro de ${what} ${where}. Isso quer dizer que nada foi lançado, não que o gasto foi zero.`
      : `${cap(where)} foram registrados ${money(cents)} de ${what} em ${plural(count, "lançamento", "lançamentos")}. Só considera o que foi lançado na Tinindo.`;
    return out("finance_spent", "consulted", `${text}${coverage(f, p)} ${updated(f.as_of)}`, { sources: [finSource(f)] });
  }

  async function receivableFlow(): Promise<EngineResult> {
    const p = periodIn("este mes", now, tz)!;
    const f = await tools.finance(p.window);
    const text = f.receivable_open_count === 0
      ? "Não há nenhuma cobrança em aberto registrada."
      : `Você tem ${money(f.receivable_open_cents)} a receber em ${plural(f.receivable_open_count, "cobrança em aberto registrada", "cobranças em aberto registradas")}${f.receivable_next_due_at ? ` (próximo vencimento: ${ddmm(localParts(f.receivable_next_due_at, tz).date)})` : ""}. É o que está registrado na Tinindo; confira com o cliente antes de cobrar.`;
    return out("finance_receivable", "consulted", `${text} ${updated(f.as_of)}`, { sources: [finSource(f)] });
  }

  async function withdrawFlow(): Promise<EngineResult> {
    const p = periodIn(n, now, tz) ?? periodIn("este mes", now, tz)!;
    const f = await tools.finance(p.window);
    const diff = f.received_cents - f.spent_cents;
    const text = `Cenário com o que está registrado ${rangeText(p)}: entrou ${money(f.received_cents)} e saiu ${money(f.spent_cents)}, `
      + `diferença de ${money(diff)}. Isso é só uma estimativa: faltam dados que não tenho, como obrigações futuras (aluguel, contas, impostos), `
      + `uma reserva mínima de segurança e o saldo real do caixa ou do banco. Com esses números você decide quanto retirar; eu não movimento dinheiro.`;
    return out("finance_withdraw", "recommendation", `${text}${coverage(f, p)} ${updated(f.as_of)}`, { sources: [finSource(f)] });
  }

  async function packageFlow(): Promise<EngineResult> {
    const dir = await tools.directory();
    const f = await tools.finance(periodIn("este mes", now, tz)!.window);
    const m = matchNames(n, dir.customers);
    const who = m.exact.length ? m.exact : m.partial;
    const pk = who.length ? f.packages.filter((x) => who.some((c) => c.id === x.customer_id)) : f.packages;
    if (pk.length === 0) {
      return out("packages", "consulted", `Não há pacote registrado${who.length ? ` para ${list(who.map((c) => displayName(c.name)))}` : ""}. ${updated(f.as_of)}`,
        { sources: [finSource(f)] });
    }
    const lines = pk.slice(0, 10).map((x) => `${customerName(dir, x.customer_id)} tem ${x.remaining_credits} de ${x.purchased_credits} sessões restantes no pacote de ${serviceName(dir, x.service_id)}.`);
    return out("packages", "consulted", `${lines.join("\n")} ${updated(f.as_of)}`,
      { sources: [finSource(f), ...pk.slice(0, 10).map((x) => ({ kind: "package", id: x.id, as_of: f.as_of }))] });
  }

  async function marginFlow(): Promise<EngineResult> {
    const dir = await tools.directory();
    const named = servicesIn(n, dir.services);
    const svcs = named.length ? named : dir.services;
    const lines = svcs.map((s) => {
      if (s.estimated_cost_cents === null) {
        return `${s.name}: não consigo calcular a margem, porque falta informar o custo estimado${s.fee_bps === null ? " e a taxa" : ""} no cadastro do serviço (preço base ${money(s.base_price_cents)}). Cadastre o custo em Serviços para eu estimar.`;
      }
      const fee = s.fee_bps === null ? 0 : Math.round((s.base_price_cents * s.fee_bps) / 10_000);
      const contrib = s.base_price_cents - s.estimated_cost_cents - fee;
      return `${s.name}: margem de contribuição estimada de ${money(contrib)} por atendimento no preço base (${money(s.base_price_cents)} menos custo ${money(s.estimated_cost_cents)} e taxa ${money(fee)}). Não inclui aluguel e outras despesas fixas.`;
    });
    return out("margin", "consulted", lines.join("\n"), { sources: [dirSource(dir)] });
  }

  // ----------------------------------------------------------------- cadastros

  async function customersFlow(): Promise<EngineResult> {
    const dir = await tools.directory();
    const src = SOURCE_WORDS.find(([re]) => re.test(n));
    if (src) {
      const k = dir.customers.filter((c) => c.declared_source === src[1]).length;
      const head = k === 0 ? `Nenhum cliente tem a origem declarada como ${src[2]}` : `${plural(k, "cliente tem", "clientes têm")} a origem declarada como ${src[2]}`;
      return out("customers_source", "consulted",
        `${head} (de ${plural(dir.customers_total, "cliente cadastrado", "clientes cadastrados")}). A origem é a informada no cadastro, não um rastreamento.`,
        { sources: [dirSource(dir)] });
    }
    const letter = /\bcomec\w* com (?:a letra )?["']?([a-z])\b/.exec(n)?.[1];
    if (letter) {
      const names = dir.customers.map((c) => displayName(c.name)).filter((x) => norm(x).startsWith(letter));
      return out("customers_letter", "consulted", names.length
        ? `Clientes que começam com ${letter.toUpperCase()}: ${list(names.slice(0, 30))}.`
        : `Nenhum cliente cadastrado começa com ${letter.toUpperCase()}.`, { sources: [dirSource(dir)] });
    }
    return out("customers", "consulted", `Você tem ${plural(dir.customers_total, "cliente cadastrado", "clientes cadastrados")}. Para ver e editar, abra a tela Clientes.`,
      { sources: [dirSource(dir)] });
  }

  async function waitlistFlow(): Promise<EngineResult> {
    const dir = await tools.directory();
    if (!dir.waitlist) return out("waitlist", "consulted", "Só o dono do negócio vê a lista de espera.");
    const { active, offered } = dir.waitlist;
    return out("waitlist", "consulted",
      `Na lista de espera: ${plural(active, "pessoa aguardando vaga", "pessoas aguardando vaga")}; ${offered === 0 ? "nenhuma oferta em andamento" : plural(offered, "oferta em andamento", "ofertas em andamento")}. `
        + "Para ver quem é e preparar ofertas, abra a tela Lista de espera. Recados de clientes não são lidos pelo assistente.",
      { sources: [{ kind: "waitlist", id: null, as_of: dir.as_of }] });
  }

  async function policyFlow(): Promise<EngineResult> {
    const dir = await tools.directory();
    const c = dir.cancellation;
    if (!c) {
      return out("policy", "consulted", "Você ainda não definiu a política de cancelamento. Defina no início do app (diagnóstico do negócio).",
        { sources: [dirSource(dir)] });
    }
    const notice = c.notice_hours === 0 ? "a qualquer momento" : `até ${plural(c.notice_hours, "hora", "horas")} antes`;
    const after = c.late_fee_bps === null
      ? "Depois disso, não há multa automática: você combina com o cliente."
      : `Depois disso, a multa combinada é de ${(c.late_fee_bps / 100).toLocaleString("pt-BR")}% do valor, cobrada por você (nada é cobrado automaticamente).`;
    return out("policy", "consulted", `Sua política de cancelamento: cancelamento ou troca de horário sem custo ${notice}. ${after}`,
      { sources: [dirSource(dir)] });
  }

  // ----------------------------------------------------------------- propostas

  function pickCustomer(dir: Directory, text: string): { one?: Customer; many: Customer[] } {
    const m = matchNames(text, dir.customers);
    const all = m.exact.length ? m.exact : m.partial;
    return all.length === 1 ? { one: all[0], many: all } : { many: all };
  }

  async function createFlow(): Promise<EngineResult> {
    if (ctx.role !== "owner") return ownerOnly("booking_create");
    const dir = await tools.directory();
    const { one: customer, many } = pickCustomer(dir, n);
    const svcs = servicesIn(n, dir.services);
    const svc = svcs.length === 1 ? svcs[0] : undefined;
    const date = dayIn(n, today);
    const time = timesIn(n)[0];
    const part = dayPartIn(n);

    const asks: string[] = [];
    let lead = "";
    if (!customer && many.length > 1) {
      lead = `Encontrei ${many.length} clientes com esse nome: ${list(many.map((c) => displayName(c.name)))}. Qual delas?`;
    } else if (!customer) {
      asks.push("para qual cliente (nome como está no cadastro)");
    }
    if (!svc) asks.push(`qual serviço (${orList(dir.services.map((s) => s.name))})`);
    if (!date) asks.push("qual dia");
    if (!time) asks.push(`qual horário${date ? ` ${onDay(date, today)}${part ? (part === "manha" ? " de manhã" : part === "tarde" ? " à tarde" : " à noite") : ""}` : ""}`);
    if (lead || asks.length) {
      const q = asks.length ? `${lead ? " Também preciso saber" : "Para preparar a proposta, preciso saber"} ${list(asks)}.` : "";
      return out("booking_create", "consulted", `${lead}${q}`.trim(), { clarification: true, sources: [dirSource(dir)] });
    }
    const c = customer!;
    const s = svc!;
    const agenda = await tools.agenda({ starts_at: zoned(date!, "00:00", tz).toISOString(), ends_at: zoned(addDays(date!, 1), "00:00", tz).toISOString() });
    const start = zoned(date!, time!, tz).getTime();
    if (!fits(agenda, date!, now, s, start)) {
      const alt = startsIn(freeWindows(agenda, date!, tz, now), s, 0, 40)
        .sort((a, b) => Math.abs(a - start) - Math.abs(b - start)).slice(0, 4).sort((a, b) => a - b);
      const opts = alt.length ? ` Horários livres para ${s.name} nesse dia: ${orList(alt.map((t) => hhmm(iso(t), tz)))}. Qual prefere?` : " Não há outro horário livre para esse serviço nesse dia.";
      return out("booking_create", "recommendation", `${time} ${onDay(date!, today)} não está disponível (fora do expediente, já ocupado ou no passado).${opts}`,
        { clarification: true, sources: [agendaSource(agenda)] });
    }
    const price = priceAt(dir.pricing_rules, s, new Date(start), tz);
    const payload = {
      customer_id: c.id, service_id: s.id, resource_id: agenda.resource_id,
      starts_at: iso(start), ends_at: iso(start + s.duration_min * 60_000), expected_price_cents: price.cents,
    };
    tools.propose("booking.create", payload);
    const priceTxt = price.rule ? `${money(price.cents)} (regra de preço ativa; preço cheio ${money(s.base_price_cents)})` : `${money(price.cents)} (preço base)`;
    const summary = `Agendar ${s.name} para ${displayName(c.name)} ${onDay(date!, today)}, às ${time} (${duration(s.duration_min)}), por ${priceTxt}. Nada é gravado antes da sua aprovação.`;
    return out("booking_create", "pending_approval", "Preparei a proposta abaixo. Nada foi gravado ainda: confira e aprove para executar.",
      { draft: { tool: "booking.create", payload, summary }, sources: [agendaSource(agenda), dirSource(dir)] });
  }

  async function changeFlow(kind: "cancel" | "reschedule"): Promise<EngineResult> {
    const intent = kind === "cancel" ? "booking_cancel" : "booking_reschedule";
    if (ctx.role !== "owner") return ownerOnly(intent);
    // Origem (qual atendimento) à esquerda de "para/pra"; destino (novo horário) à direita.
    const split = kind === "reschedule" ? /\s(?:para|pra|pro)\s/.exec(n) : null;
    const left = split ? n.slice(0, split.index) : n;
    const right = split ? n.slice(split.index + split[0].length) : "";
    const dir = await tools.directory();
    const { one: customer, many } = pickCustomer(dir, left);
    if (!customer && many.length > 1) {
      return out(intent, "consulted", `Encontrei ${many.length} clientes com esse nome: ${list(many.map((c) => displayName(c.name)))}. Qual delas?`,
        { clarification: true, sources: [dirSource(dir)] });
    }
    const svcs = servicesIn(left, dir.services);
    const day = dayIn(left, today);
    const time = timesIn(left)[0];
    const agenda = await tools.agenda({ starts_at: zoned(today, "00:00", tz).toISOString(), ends_at: zoned(addDays(today, 14), "00:00", tz).toISOString() });
    const cands = agenda.bookings.filter((b) => ACTIVE.has(b.status) && Date.parse(b.starts_at) > now.getTime()
      && (!customer || b.customer_id === customer.id)
      && (svcs.length !== 1 || b.service_id === svcs[0]!.id)
      && (!day || localParts(b.starts_at, tz).date === day)
      && (!time || hhmm(b.starts_at, tz) === time));
    const verb = kind === "cancel" ? "cancelar" : "remarcar";
    if (!customer && svcs.length !== 1 && !day && !time) {
      const nextOnes = cands.slice(0, 5).map((b) => bookingRef(dir, b));
      return out(intent, "consulted", `Qual atendimento você quer ${verb}?${nextOnes.length ? ` Os próximos são: ${list(nextOnes)}.` : ""}`,
        { clarification: true, sources: [agendaSource(agenda)] });
    }
    if (cands.length === 0) {
      return out(intent, "consulted", `Não encontrei atendimento futuro com esses dados nos próximos 14 dias. ${updated(agenda.as_of)}`,
        { sources: [agendaSource(agenda)] });
    }
    if (cands.length > 1) {
      return out(intent, "consulted",
        `Encontrei ${cands.length} atendimentos: ${list(cands.slice(0, 8).map((b) => bookingRef(dir, b)))}. Qual deles você quer ${verb}?`,
        { clarification: true, sources: [agendaSource(agenda), ...bookingSources(agenda, cands)] });
    }
    const b = cands[0]!;
    const svc = dir.services.find((s) => s.id === b.service_id);
    const ref = bookingRef(dir, b);
    const agreed = b.agreed_price_cents !== null ? ` O valor combinado (${money(b.agreed_price_cents)}) é mantido.` : "";
    const sources = [agendaSource(agenda), ...bookingSources(agenda, [b])];

    if (kind === "cancel") {
      const payload = { booking_id: b.id, expected_version: b.version, reason: "Cancelado pelo dono pelo assistente" };
      tools.propose("booking.cancel", payload);
      return out(intent, "pending_approval", "Preparei a proposta de cancelamento abaixo. Nada muda até você aprovar.", {
        sources,
        draft: { tool: "booking.cancel", payload,
          summary: `Cancelar o atendimento de ${ref}. O horário fica livre. A Tinindo não avisa o cliente por você.` },
      });
    }
    if (!svc) return out(intent, "consulted", "Não encontrei o serviço desse atendimento.", { sources });
    const bDate = localParts(b.starts_at, tz).date;
    const tDate = dayIn(right, today) ?? bDate;
    const tTime = timesIn(right)[0];
    const tAgenda = tDate === bDate || (tDate >= today && tDate < addDays(today, 14)) ? agenda
      : await tools.agenda({ starts_at: zoned(tDate, "00:00", tz).toISOString(), ends_at: zoned(addDays(tDate, 1), "00:00", tz).toISOString() });
    if (!tTime) {
      const later = /\bmais tarde\b|\bdepois\b/.test(right);
      const earlier = /\bmais cedo\b|\bantes\b/.test(right);
      let opts = startsIn(freeWindows(tAgenda, tDate, tz, now, undefined, b.id), svc,
        later ? Date.parse(b.occupied.ends_at) : 0, 40);
      if (earlier) opts = opts.filter((t) => t < Date.parse(b.starts_at));
      opts = opts.slice(0, 5);
      const what = `${serviceName(dir, b.service_id)}, ${customerName(dir, b.customer_id)}`;
      const where = later ? `${onDay(tDate, today)} depois do atendimento das ${hhmm(b.starts_at, tz)} (${what})` : `${onDay(tDate, today)} para ${ref}`;
      return out(intent, "recommendation", opts.length
        ? `Opções livres ${where}: ${orList(opts.map((t) => hhmm(iso(t), tz)))}. Qual horário você prefere?${agreed}`
        : `Não há horário livre ${where} para esse atendimento. Qual outro dia você prefere?`,
      { clarification: true, sources });
    }
    const start = zoned(tDate, tTime, tz).getTime();
    if (!fits(tAgenda, tDate, now, svc, start, b.id)) {
      return out(intent, "recommendation", `${tTime} ${onDay(tDate, today)} não está disponível para esse atendimento. Qual outro horário você prefere?`,
        { clarification: true, sources });
    }
    const payload = { booking_id: b.id, expected_version: b.version, starts_at: iso(start), ends_at: iso(start + svc.duration_min * 60_000) };
    tools.propose("booking.reschedule", payload);
    return out(intent, "pending_approval", "Preparei a proposta de remarcação abaixo. Nada muda até você aprovar.", {
      sources,
      draft: { tool: "booking.reschedule", payload,
        summary: `Remarcar o atendimento de ${ref} para ${onDay(tDate, today)}, às ${tTime}.${agreed}` },
    });
  }

  async function pricingFlow(escalation: boolean): Promise<EngineResult> {
    if (ctx.role !== "owner") return ownerOnly("pricing_rule");
    const bps = percentIn(n);
    const wd = weekdayIn(n);
    const dir = await tools.directory();
    const floors = list(dir.services.map((s) => `${s.name} ${money(s.min_price_cents)}`));
    const personal = /\bpra (ela|ele)\b|\bpara (ela|ele)\b/.test(n) || matchNames(n, dir.customers).exact.length > 0;
    if (bps === null || wd === null || personal) {
      const asks = personal || bps === null
        ? "Para quem seria o desconto e de quanto (qual percentual)?"
        : "Em qual dia da semana e horário o desconto valeria?";
      return out("pricing_rule", "consulted",
        `${asks} Hoje eu só consigo propor regras de preço por dia e horário (por exemplo, "15% na terça das 13h às 17h"); desconto para um cliente específico ainda não está disponível. O piso de cada serviço sempre vale: ${floors}.`,
        { clarification: true, sources: [dirSource(dir)] });
    }
    const named = servicesIn(n, dir.services);
    const svcs = named.length ? named : dir.services;
    const times = timesIn(n);
    let from = times[0];
    let to = times[1];
    let agenda: Agenda | null = null;
    if (!from || !to) {
      const date = addDays(today, (wd - localParts(now, tz).weekday + 7) % 7);
      agenda = await tools.agenda({ starts_at: zoned(date, "00:00", tz).toISOString(), ends_at: zoned(addDays(date, 1), "00:00", tz).toISOString() });
      const open = agenda.days.find((d) => d.date === date)?.open ?? [];
      if (open.length === 0) {
        return out("pricing_rule", "consulted", `Não há expediente cadastrado ${WEEKDAY_NAMES[wd]}. Em qual horário o desconto valeria?`,
          { clarification: true, sources: [agendaSource(agenda)] });
      }
      from = hhmm(open[0]!.starts_at, tz);
      to = hhmm(open.at(-1)!.ends_at, tz);
    }
    if (from! >= to!) {
      return out("pricing_rule", "consulted", "O horário final precisa ser depois do inicial. Qual janela de horário?", { clarification: true });
    }
    const previews: string[] = [];
    const rules: Record<string, unknown>[] = [];
    const blocked: string[] = [];
    for (const s of svcs) {
      const r = computePrice({ base_cents: s.base_price_cents, manual_floor_cents: s.min_price_cents, estimated_cost_cents: s.estimated_cost_cents,
        fee_bps: s.fee_bps, target_margin_bps: 0, discount_bps: bps, max_discount_bps: bps });
      if (!r.ok) {
        blocked.push(s.name);
        continue;
      }
      previews.push(`${s.name} de ${money(s.base_price_cents)} por ${money(r.final_cents)}${r.reason === "FLOOR_APPLIED" ? " (piso)" : ""}`);
      rules.push({ service_id: s.id, windows: [{ weekday: wd, local_start: from, local_end: to }], discount_bps: bps, max_discount_bps: bps, target_margin_bps: 0 });
    }
    if (rules.length === 0) {
      return out("pricing_rule", "consulted", `Não dá para propor esse desconto: o piso de ${list(blocked)} está acima do preço base. Revise o cadastro do serviço.`,
        { sources: [dirSource(dir)] });
    }
    const validTo = new Date(now.getTime() + RULE_VALID_DAYS * 86_400_000);
    const payload = {
      weekday: WEEKDAY_KEYS[wd], discount_bps: bps, local_start: from, local_end: to,
      valid_from: iso(Math.floor(now.getTime() / 1000) * 1000), valid_to: iso(Math.floor(validTo.getTime() / 1000) * 1000), rules,
    };
    tools.propose("pricing.propose_rule", payload);
    const pct = (bps / 100).toLocaleString("pt-BR");
    const summary = `Regra de preço: ${pct}% de desconto às ${WEEKDAY_NAMES[wd]}s, das ${from} às ${to}, por ${RULE_VALID_DAYS} dias (até ${ddmm(localParts(validTo, tz).date)}). `
      + `Com o piso (preço mínimo de cada serviço): ${list(previews)}.${blocked.length ? ` Fica de fora: ${list(blocked)} (piso acima do preço base).` : ""} `
      + "Ao aprovar, a Tinindo cria a proposta na tela de Preços; ela só passa a valer quando você publicar lá.";
    const text = escalation
      ? "Seu papel e as regras não mudam por mensagem, e nada é aplicado automaticamente: preparei a proposta abaixo para você conferir e aprovar."
      : "Preparei a proposta de regra de preço abaixo. Nada muda até você aprovar.";
    return out("pricing_rule", "pending_approval", text, {
      draft: { tool: "pricing.propose_rule", payload, summary: summary.slice(0, 1000) },
      sources: [dirSource(dir), ...(agenda ? [agendaSource(agenda)] : [])],
    });
  }
}
