// EMULAÇÃO de Metas e conteúdo para a demonstração sem servidor. Mesmas regras do banco que a tela explica: progresso
// é o indicador do mês (com denominador; insuficiente ≠ zero); uma meta ativa por indicador e mês; sugestões só por
// regras sobre dado existente, com evidência; decisão uma vez por mês, acompanhada 30 dias depois como variação
// observada; conteúdo aprovado por profissão, publicado só com perfil publicado e campo `bio` escolhido.
import { type AdviceListOutput, type ContentListOutput, DEFAULT_MESSAGES, ERROR_STATUS, type ErrorCode, type Goal, GoalSaveInput, RETRYABLE } from "@contracts";
import { FIXED_NOW, tenantA } from "@contracts/fixtures.ts";
import type { z } from "zod";
import { ApiError } from "../../lib/api/client.ts";
import { METRIC_LABEL } from "./labels.ts";
import type { Advice, Content, GoalList, GrowthAdvicePort } from "./port.ts";

function fail(code: ErrorCode, field?: string): never {
  throw new ApiError(code, DEFAULT_MESSAGES[code], ERROR_STATUS[code], crypto.randomUUID(), RETRYABLE.has(code), field);
}
const clone = <T>(v: T): T => structuredClone(v);
type Decision = z.infer<typeof AdviceListOutput>["decisions"][number];
type Published = z.infer<typeof ContentListOutput>["published"];
interface State { goals: Goal[]; decisions: Decision[]; published: Published; bioField: boolean; idem: Map<string, unknown>; seq: number; clock: number }
let shared: State | null = null;
const state = (): State => (shared ??= { goals: [], decisions: [], published: null, bioField: true, idem: new Map(), seq: 0, clock: Date.parse(FIXED_NOW) });
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
/** Indicadores sintéticos do mês (mesma agenda de exemplo do Resultado): dado existente para quase tudo. */
const METRICS: GoalList["metrics"] = [
  { key: "occupancy", label: "Ocupação", unit: "ratio", numerator: 2880, denominator: 7200, value: 0.4, status: "ok", note: "Minutos reservados sobre o expediente vendável." },
  { key: "no_show", label: "Faltas", unit: "ratio", numerator: 6, denominator: 40, value: 0.15, status: "ok", note: "Faltas sobre atendimentos com desfecho." },
  { key: "cancellation", label: "Cancelamentos", unit: "ratio", numerator: 3, denominator: 43, value: 0.0698, status: "ok", note: "Cancelados sobre concluídos, faltas e cancelados." },
  { key: "waitlist_acceptance", label: "Ofertas de vaga aceitas", unit: "ratio", numerator: 0, denominator: 0, value: null, status: "insufficient", note: "Ofertas aceitas sobre ofertas preparadas." },
  { key: "quote_acceptance", label: "Orçamentos aceitos", unit: "ratio", numerator: 7, denominator: 10, value: 0.7, status: "ok", note: "Aceitos sobre orçamentos com link gerado." },
  { key: "received", label: "Recebimentos registrados", unit: "cents", numerator: 170000, denominator: null, value: 170000, status: "ok", note: "Soma do lançado como recebido." },
  { key: "expenses", label: "Despesas registradas", unit: "cents", numerator: 12000, denominator: null, value: 12000, status: "ok", note: "Soma das despesas lançadas." },
  { key: "charge_coverage", label: "Atendimentos com cobrança registrada", unit: "ratio", numerator: 28, denominator: 34, value: 0.8235, status: "ok", note: "Concluídos com cobrança lançada." },
  { key: "human_minutes", label: "Minutos da equipe Tinindo", unit: "minutes", numerator: 0, denominator: null, value: 0, status: "ok", note: "Minutos humanos em serviços assistidos." },
  { key: "reminders", label: "Lembretes enviados", unit: "ratio", numerator: 20, denominator: 40, value: 0.5, status: "ok", note: "Atendimentos com lembrete enviado ou compartilhado." },
];
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
  const ns = metric("no_show"), rem = metric("reminders"), occ = metric("occupancy"), cov = metric("charge_coverage"), q = metric("quote_acceptance");
  if (ns.status === "ok" && ns.denominator! >= 5 && ns.value! >= 0.15 && (rem.status !== "ok" || rem.value! < 0.8)) {
    out.push({ rule_code: "no_show_reminders", metric_key: "no_show", title: "Faltas acima de 15% e lembretes abaixo de 80%", text: "Ligue ou amplie os lembretes (24 h e 2 h antes). A régua sai sozinha pelo canal ou fica pronta para compartilhar.", route: "/app/relacionamento", evidence: { no_show: ns.value, no_show_n: ns.denominator, reminders: rem.value } });
  }
  if (occ.status === "ok" && occ.value! < 0.5) {
    out.push({ rule_code: "occupancy_campaign", metric_key: "occupancy", title: "Ocupação abaixo de 50% com clientes autorizadas sem atendimento há 30 dias", text: "Monte uma campanha com grupo de controle para quem não vem há 30 dias; o resultado sai por braço, com intervalo.", route: "/app/campanhas", evidence: { occupancy: occ.value, sellable_minutes: occ.denominator, audience: 6 } });
  }
  if (cov.status === "ok" && cov.denominator! >= 5 && cov.value! < 0.9) {
    out.push({ rule_code: "charge_coverage", metric_key: "charge_coverage", title: "Menos de 90% dos atendimentos com cobrança registrada", text: "Registre a cobrança ao concluir o atendimento (ou use o link de pagamento). Sem isso, o Recebido fica incompleto.", route: "/app/caixa", evidence: { charge_coverage: cov.value, completed: cov.denominator } });
  }
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
    async followUp() {
      const s = state();
      s.clock += 31 * 86_400_000;
      let n = 0;
      for (const d of s.decisions) {
        if (d.metric_after) continue;
        const m = d.metric_key ? metric(d.metric_key) : null;
        // Medido de novo (na simulação, faltas caem para 10%): variação observada, nunca efeito.
        const after = m ? (d.metric_key === "no_show" ? { ...m, value: 0.1, numerator: 4 } : m) : null;
        d.metric_after = after ? { value: after.value, numerator: after.numerator, denominator: after.denominator, status: after.status } : { status: "unavailable" };
        const b = d.metric_before?.value as number | null | undefined, a = after?.value ?? null;
        d.outcome = b == null || a == null ? "insufficient" : Math.abs(a - b) < 0.02 ? "unchanged" : (DOWN.has(d.metric_key ?? "") ? a < b : a > b) ? "improved" : "worsened";
        n++;
      }
      return { followed_up: n };
    },
  };
}
