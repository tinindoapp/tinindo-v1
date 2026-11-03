// EMULAÇÃO de Metas e sugestões (P22; os insights do P45 estão em demoInsights.ts) para a demonstração sem servidor. Mesmas regras do banco que a tela explica: progresso
// é o indicador do mês (com denominador; insuficiente ≠ zero); uma meta ativa por indicador e mês; sugestões só por
// regras sobre dado existente, com evidência; decisão uma vez por mês, acompanhada 30 dias depois como variação
// observada; conteúdo aprovado por profissão, publicado só com perfil publicado e campo `bio` escolhido.
import { type AdviceListOutput, type ContentListOutput, DEFAULT_MESSAGES, ERROR_STATUS, type ErrorCode, type Goal, GoalSaveInput, type Insight, type InsightListOutput, RETRYABLE } from "@contracts";
import { FIXED_NOW, tenantA } from "@contracts/fixtures.ts";
import type { z } from "zod";
import { ApiError } from "../../lib/api/client.ts";
import { demoCounts, demoMetrics, demoMonthToDate } from "../../lib/demo/dataset.ts";
import { RULES, runDemoEngine } from "./demoInsights.ts";
import { METRIC_LABEL } from "./labels.ts";
import type { Advice, Content, Digests, GoalList, GrowthAdvicePort, InsightCommand, InsightList } from "./port.ts";

function fail(code: ErrorCode, field?: string): never {
  throw new ApiError(code, DEFAULT_MESSAGES[code], ERROR_STATUS[code], crypto.randomUUID(), RETRYABLE.has(code), field);
}
const clone = <T>(v: T): T => structuredClone(v);
type Decision = z.infer<typeof AdviceListOutput>["decisions"][number];
type Published = z.infer<typeof ContentListOutput>["published"];
type Measure = { value: number | null; numerator: number | null; denominator: number | null; status: string; direction?: "up" | "down" };
interface State {
  goals: Goal[]; decisions: Decision[]; published: Published; bioField: boolean; idem: Map<string, unknown>; seq: number; clock: number;
  /** P45: insights da rodada do motor (emulada uma vez, na primeira leitura) e o número acompanhado de cada um. */
  insights: Insight[] | null; rules: InsightList["rules"]; measures: Map<string, Measure>;
}
let shared: State | null = null;
const state = (): State => (shared ??= { goals: [], decisions: [], published: null, bioField: true, idem: new Map(), seq: 0, clock: Date.parse(FIXED_NOW), insights: null, rules: [], measures: new Map() });
const ts = () => new Date(state().clock).toISOString();
const id = (p: string) => `${p}-0000-4000-8000-${String(++state().seq).padStart(12, "0")}`;
const MONTH = FIXED_NOW.slice(0, 7) + "-01";
/** Só para testes. */
export function resetDemoState() {
  shared = null;
}
/** Só para testes e para a demonstração: simula o dono tirando/pondo o campo `bio` no perfil (P09). */
export function setDemoBioField(on: boolean) {
  state().bioField = on;
}
const once = async <T>(key: string, run: () => T): Promise<T> => {
  const s = state();
  if (s.idem.has(key)) return clone(s.idem.get(key)) as T;
  const v = run();
  s.idem.set(key, clone(v));
  return clone(v);
};
/** Indicadores do mês até ontem, da base de exemplo única (dataset.ts): os mesmos do Resultado em "Este mês". */
const METRICS: GoalList["metrics"] = demoMetrics(demoMonthToDate()).metrics;
const metric = (key: string) => METRICS.find((m) => m.key === key)!;
const DOWN = new Set(["no_show", "cancellation", "expenses"]);
function withProgress(g: Goal): Goal {
  const m = metric(g.metric_key);
  const v = m.status === "ok" ? m.value : null;
  let attainment: number | null = null, achieved: boolean | null = null;
  if (v !== null) {
    if (g.direction === "up") { attainment = g.target === 0 ? 1 : Math.min(1, +(v / g.target).toFixed(4)); achieved = v >= g.target; }
    else { attainment = v === 0 ? 1 : Math.min(1, +(g.target / v).toFixed(4)); achieved = v <= g.target; }
  }
  return clone({ ...g, label: m.label, unit: m.unit, progress: { value: v, numerator: m.numerator, denominator: m.denominator, status: m.status, note: m.note, attainment, achieved } });
}
function rules(): Advice["suggestions"] {
  const out: Advice["suggestions"] = [];
  const ns = metric("no_show"), rem = metric("reminders"), occ = metric("occupancy"), q = metric("quote_acceptance");
  if (ns.status === "ok" && ns.denominator! >= 5 && ns.value! >= 0.15 && (rem.status !== "ok" || rem.value! < 0.8)) {
    out.push({ rule_code: "no_show_reminders", metric_key: "no_show", title: "Faltas acima de 15% e lembretes abaixo de 80%", text: "Ligue ou amplie os lembretes (24 h e 2 h antes). A régua sai sozinha pelo canal ou fica pronta para compartilhar.", route: "/app/relacionamento", evidence: { no_show: ns.value, no_show_n: ns.denominator, reminders: rem.value } });
  }
  if (occ.status === "ok" && occ.value! < 0.5) {
    out.push({ rule_code: "occupancy_campaign", metric_key: "occupancy", title: "Ocupação abaixo de 50% com clientes autorizadas sem atendimento há 30 dias", text: "Monte uma campanha com grupo de controle para quem não vem há 30 dias; o resultado sai por braço, com intervalo.", route: "/app/campanhas", evidence: { occupancy: occ.value, sellable_minutes: occ.denominator, audience: 6 } });
  }
  // A regra de cobrança passou para o motor de insights (P45, `uncharged_bookings`).
  if (q.status === "ok" && q.denominator! >= 5 && q.value! >= 0.6) {
    out.push({ rule_code: "quote_recurrence", metric_key: "quote_acceptance", title: "Mais de 60% dos orçamentos aceitos", text: "Quem aceita bem tende a aceitar um plano: ofereça assinatura do serviço mais pedido (termos congelados na adesão).", route: "/app/assinaturas", evidence: { quote_acceptance: q.value, quotes: q.denominator } });
  }
  if (state().bioField && !state().published) {
    out.push({ rule_code: "profile_bio", metric_key: null, title: "Perfil público sem apresentação", text: "Você escolheu mostrar a apresentação no perfil, mas ela está vazia. Publique um texto aprovado para a sua profissão.", route: "/app/metas", evidence: { profile_published: true, bio_field: true } });
  }
  return out;
}
const RAW: { code: string; profession: Content["templates"][number]["profession"]; kind: "bio" | "post"; title: string; body: string; preview: string; approved_by: string }[] = [
  { code: "bio_barber_classico", profession: "barber", kind: "bio", title: "Apresentação clássica", body: "{{business}} em {{area}}: cortes, barba e cuidado com horário marcado. Agende pelo link e chegue na hora combinada.", preview: "", approved_by: "tinindo" },
  { code: "bio_barber_familia", profession: "barber", kind: "bio", title: "Apresentação família", body: "Barbearia de bairro em {{area}}. Atendimento com hora marcada para você e para a família, sem fila.", preview: "", approved_by: "tinindo" },
  { code: "bio_other_simples", profession: "all", kind: "bio", title: "Apresentação simples", body: "{{business}} em {{area}}. Atendimento com hora marcada: agende pelo link e receba a confirmação.", preview: "", approved_by: "tinindo" },
  { code: "post_horarios_semana", profession: "all", kind: "post", title: "Horários da semana", body: "Abrimos a agenda da semana no {{business}} ({{area}}). Garanta seu horário pelo link; confirmamos na hora.", preview: "", approved_by: "tinindo" },
  { code: "post_retorno", profession: "all", kind: "post", title: "Convite de retorno", body: "Faz tempo que não nos vemos? O {{business}} está com horários abertos em {{area}}. Agende pelo link.", preview: "", approved_by: "tinindo" },
];
const TEMPLATES: Content["templates"] = RAW.map((t) => ({ ...t, preview: t.body.replaceAll("{{business}}", tenantA.name).replaceAll("{{area}}", "Pinheiros") }));

const DAY = 86_400_000;
const day = (t: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(t));
/** Rodada do motor emulada uma vez (como o worker de madrugada): rodar de novo não duplica nada. */
function engine(): Insight[] {
  const s = state();
  if (s.insights) return s.insights;
  const r = runDemoEngine(s.clock);
  s.rules = r.rules;
  s.insights = r.fired.map(({ measure, ...f }) => {
    const rule = RULES.find((x) => x.code === f.rule_code)!;
    const i: Insight = { ...f, id: id("e3000000"), rule_title: rule.title, priority: rule.priority, state: "open", first_seen_on: day(s.clock), last_seen_on: day(s.clock),
      valid_until: new Date(s.clock + 2 * DAY).toISOString(), quiet_until: null, acted_at: null, result: null, decision: null, version: 1 };
    s.measures.set(i.id, measure);
    return i;
  });
  return s.insights;
}
/** Decisão no P22 (uma por regra e mês), com o número de agora congelado. */
function decideInsight(i: Insight, decision: "accepted" | "dismissed"): Insight["decision"] {
  const s = state();
  const m = s.measures.get(i.id);
  if (!m || m.status !== "ok" || s.decisions.some((d) => d.rule_code === i.rule_code && d.decided_at.slice(0, 7) === ts().slice(0, 7))) return i.decision;
  const d: Decision = { id: id("e2000000"), rule_code: i.rule_code, metric_key: null, decision, evidence: i.evidence, metric_before: { ...m }, metric_after: null, outcome: null,
    decided_at: ts(), follow_up_at: new Date(s.clock + 30 * DAY).toISOString() };
  s.decisions.unshift(d);
  return { id: d.id, decision, outcome: null, follow_up_at: d.follow_up_at, metric_before: d.metric_before, metric_after: null };
}
function findOpen(input: Insight): Insight {
  const i = engine().find((x) => x.id === input.id) ?? fail("NOT_FOUND");
  if (i.version !== input.version) fail("STALE_VERSION");
  if (i.state !== "open") fail("POLICY_REJECTED", "state");
  return i;
}
const brl = (c: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(c / 100).replace(/\u00a0/g, " ");
const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
/** Resumo da semana encerrada (segunda a domingo antes de hoje), pelo mesmo modelo fixo do banco. */
function weeklyDigest(): Digests["digests"][number] {
  const s = state();
  const today = Date.parse(`${day(s.clock)}T12:00:00Z`);
  const monday = today - ((new Date(today).getUTCDay() + 6) % 7) * DAY;
  const ws = day(monday - 7 * DAY), we = day(monday - DAY);
  const c = demoCounts({ starts_at: `${ws}T03:00:00.000Z`, ends_at: `${day(monday)}T03:00:00.000Z` }, new Date(s.clock));
  const open = engine().filter((i) => i.state === "open").length;
  const body = [
    `Resumo da semana de ${ddmm(ws)} a ${ddmm(we)}.`,
    `Atendimentos: ${c.done} concluído(s), ${c.noShow} falta(s) e ${c.cancelled} cancelamento(s).`,
    `Recebido registrado: ${brl(c.received)} · Despesas registradas: ${brl(c.spent)}.`,
    "Clientes novos no cadastro: 0.",
    open === 0 ? "Nenhuma sugestão aberta: as regras só falam quando há dado suficiente." : `Para esta semana: ${open} sugestão(ões) em Metas e sugestões.`,
    "Texto automático por modelo fixo, com os números registrados no app.",
  ].join("\n");
  return { id: "e4000000-0000-4000-8000-000000000001", week_start: ws, body, created_at: new Date(monday + 6 * 3_600_000).toISOString(),
    facts: { period_start: ws, period_end: we, has_history: true, completed: c.done, no_show: c.noShow, cancelled: c.cancelled, received_cents: c.received, expenses_cents: c.spent, new_customers: 0, open_insights: open } };
}

export function createDemoPort(): GrowthAdvicePort {
  return {
    kind: "demo",
    async goals(): Promise<GoalList> {
      const start = Date.parse(FIXED_NOW.slice(0, 7) + "-01T03:00:00Z");
      return { month_start: new Date(start).toISOString(), month_end: new Date(start + 31 * 86_400_000).toISOString(), goals: state().goals.map(withProgress), metrics: clone(METRICS) };
    },
    saveGoal(raw, key) {
      return once(key, () => {
        const parsed = GoalSaveInput.safeParse(raw);
        if (!parsed.success) fail("VALIDATION_ERROR", parsed.error.issues[0]?.path.join(".") ?? "input");
        const input = parsed.data;
        const unit = input.metric_key === "received" || input.metric_key === "expenses" ? "cents" : "ratio";
        if ((unit === "ratio" && input.target > 1) || (unit === "cents" && !Number.isInteger(input.target))) fail("VALIDATION_ERROR", "target");
        const s = state();
        if (input.goal_id) {
          const g = s.goals.find((x) => x.id === input.goal_id) ?? fail("NOT_FOUND");
          if (g.version !== input.expected_version) fail("STALE_VERSION");
          if (g.status !== "active") fail("POLICY_REJECTED", "status");
          Object.assign(g, { target: input.target, note: input.note, version: g.version + 1 });
          return withProgress(g);
        }
        const period = input.period_start ?? MONTH;
        if (s.goals.some((x) => x.metric_key === input.metric_key && x.period_start === period && x.status === "active")) fail("POLICY_REJECTED", "goal");
        const g: Goal = { id: id("e1000000"), metric_key: input.metric_key, label: METRIC_LABEL[input.metric_key], unit, target: input.target, direction: DOWN.has(input.metric_key) ? "down" : "up",
          period_start: period, note: input.note, status: "active", created_at: ts(), version: 1, progress: { value: null, numerator: null, denominator: null, status: "insufficient", note: null, attainment: null, achieved: null } };
        s.goals.unshift(g);
        return withProgress(g);
      });
    },
    archiveGoal(input, key) {
      return once(key, () => {
        const g = state().goals.find((x) => x.id === input.id) ?? fail("NOT_FOUND");
        if (g.version !== input.version) fail("STALE_VERSION");
        if (g.status !== "active") fail("POLICY_REJECTED", "status");
        Object.assign(g, { status: "archived", version: g.version + 1 });
        return withProgress(g);
      });
    },
    async advice(): Promise<Advice> {
      return clone({ suggestions: rules(), decisions: state().decisions });
    },
    decide(ruleCode, decision, key) {
      return once(key, () => {
        const s = rules().find((x) => x.rule_code === ruleCode) ?? fail("POLICY_REJECTED", "rule_code");
        if (state().decisions.some((d) => d.rule_code === ruleCode && d.decided_at.slice(0, 7) === ts().slice(0, 7))) fail("POLICY_REJECTED", "decided");
        const m = s.metric_key ? metric(s.metric_key) : null;
        state().decisions.unshift({ id: id("e2000000"), rule_code: ruleCode, metric_key: s.metric_key, decision, evidence: s.evidence,
          metric_before: m ? { value: m.value, numerator: m.numerator, denominator: m.denominator, status: m.status } : null, metric_after: null, outcome: null,
          decided_at: ts(), follow_up_at: new Date(state().clock + 30 * 86_400_000).toISOString() });
      });
    },
    async content(): Promise<Content> {
      return clone({ profession: "barber", scope: { profile_published: true, bio_field: state().bioField }, published: state().published, templates: TEMPLATES });
    },
    publish(code, key) {
      return once(key, () => {
        const t = TEMPLATES.find((x) => x.code === code) ?? fail("NOT_FOUND", "template_code");
        if (t.kind !== "bio") fail("POLICY_REJECTED", "kind");
        if (!state().bioField) fail("POLICY_REJECTED", "scope");
        const prev = state().published;
        state().published = { template_code: t.code, body: t.preview, published_at: ts(), version: (prev?.version ?? 0) + 1 };
      });
    },
    unpublish(expectedVersion, key) {
      return once(key, () => {
        const p = state().published ?? fail("NOT_FOUND");
        if (p.version !== expectedVersion) fail("STALE_VERSION");
        state().published = null;
      });
    },
    async insights(scope): Promise<InsightList> {
      const all = engine();
      const open = all.filter((i) => i.state === "open").sort((a, b) => b.priority - a.priority);
      const rest = all.filter((i) => i.state !== "open");
      return clone({ run: { run_date: day(Date.parse(FIXED_NOW)), finished_at: FIXED_NOW }, insights: scope === "home" ? open.slice(0, 3) : [...open, ...rest],
        rules: scope === "home" ? [] : state().rules } satisfies z.infer<typeof InsightListOutput>);
    },
    snoozeInsight(input, key) {
      return once(key, (): InsightCommand => {
        const i = findOpen(input);
        Object.assign(i, { state: "snoozed", quiet_until: new Date(state().clock + 30 * DAY).toISOString(), decision: decideInsight(i, "dismissed"), version: i.version + 1 });
        return { insight: clone(i), result: null };
      });
    },
    actInsight(input, key) {
      return once(key, (): InsightCommand => {
        const i = findOpen(input);
        const a = i.action;
        const result: InsightCommand["result"] = a.operation === "pricing.propose_rule"
          ? { kind: "pricing_proposal", created: 1, skipped: 0, route: "/app/precos", ref: id("e5000000") }
          : a.operation ? { kind: "lifecycle_drafts", created: i.evidence.numerator, skipped: 0, route: "/app/relacionamento" }
          : { kind: a.kind === "none" ? "none" : "open", created: 0, skipped: 0, route: a.route };
        Object.assign(i, { state: "acted", acted_at: ts(), result, quiet_until: new Date(state().clock + 30 * DAY).toISOString(),
          decision: a.kind === "none" ? i.decision : decideInsight(i, "accepted"), version: i.version + 1 });
        return { insight: clone(i), result };
      });
    },
    async digests(): Promise<Digests> {
      return clone({ digests: [weeklyDigest()] });
    },
    async followUp() {
      const s = state();
      s.clock += 31 * 86_400_000;
      let n = 0;
      for (const d of s.decisions) {
        if (d.metric_after) continue;
        const m = d.metric_key ? metric(d.metric_key) : null;
        // Regras do P45: na simulação, a cobrança passa a ser registrada em todos (as outras ficam iguais).
        const insight = !d.metric_key && d.metric_before ? (d.metric_before as Measure) : null;
        const insightAfter = insight ? (d.rule_code === "uncharged_bookings" ? { ...insight, value: 1, numerator: insight.denominator } : insight) : null;
        // Medido de novo (na simulação, faltas caem para 10%): variação observada, nunca efeito.
        const after = insightAfter ?? (m ? (d.metric_key === "no_show" ? { ...m, value: 0.1, numerator: 4 } : m) : null);
        d.metric_after = after ? { value: after.value, numerator: after.numerator, denominator: after.denominator, status: after.status } : { status: "unavailable" };
        const b = d.metric_before?.value as number | null | undefined, a = after?.value ?? null;
        const down = insight ? insight.direction === "down" : DOWN.has(d.metric_key ?? "");
        d.outcome = b == null || a == null ? "insufficient" : Math.abs(a - b) < 0.02 ? "unchanged" : (down ? a < b : a > b) ? "improved" : "worsened";
        const linked = state().insights?.find((i) => i.decision?.id === d.id);
        if (linked?.decision) linked.decision = { ...linked.decision, outcome: d.outcome, metric_after: d.metric_after };
        n++;
      }
      return { followed_up: n };
    },
  };
}
