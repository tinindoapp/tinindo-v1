// EMULAÇÃO do motor de insights (P45) para a demonstração sem servidor, sempre rotulada. Mesmas regras do banco
// (migration p45) sobre a base de exemplo única (dataset.ts): atendimentos sem cobrança, faltas concentradas,
// horário ocioso e clientes sem retorno são CALCULADOS; as demais regras seguem o estado da demonstração (sem
// lista de espera ativa, pacote longe de vencer, mês longe do fim). Insuficiente ≠ zero.
import type { Insight, InsightListOutput, InsightRuleCode } from "@contracts";
import { FIXED_NOW } from "@contracts/fixtures.ts";
import type { z } from "zod";
import { DEMO_SERVICES, DEMO_TZ, DEMO_WEEKLY_HOURS, demoCounts, demoVisits } from "../../lib/demo/dataset.ts";

type RuleStatus = z.infer<typeof InsightListOutput>["rules"][number];
type Fired = Omit<Insight, "id" | "state" | "first_seen_on" | "last_seen_on" | "quiet_until" | "acted_at" | "result" | "decision" | "version" | "rule_title" | "priority" | "valid_until"> & {
  measure: { value: number | null; numerator: number; denominator: number; status: "ok" | "insufficient"; direction: "up" | "down" };
};
export interface EngineResult { rules: RuleStatus[]; fired: Fired[] }

const DAY = 86_400_000;
const WEEKDAY = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
export const RULES: { code: InsightRuleCode; title: string; flow: RuleStatus["flow"]; priority: number }[] = [
  { code: "uncharged_bookings", title: "Atendimentos sem cobrança", flow: "P07", priority: 90 },
  { code: "waitlist_opening", title: "Vaga aberta com gente esperando", flow: "P06", priority: 85 },
  { code: "no_show_concentration", title: "Faltas concentradas", flow: "P13", priority: 80 },
  { code: "package_expiring", title: "Pacote perto de vencer", flow: "P13", priority: 75 },
  { code: "lapsed_customers", title: "Clientes sem retorno", flow: "P13", priority: 70 },
  { code: "idle_slot", title: "Horário ocioso recorrente", flow: "P05", priority: 60 },
  { code: "low_margin_service", title: "Serviço abaixo da margem", flow: "P05", priority: 55 },
  { code: "profile_incomplete", title: "Perfil incompleto", flow: "P44", priority: 50 },
  { code: "month_closing", title: "Mês fechando", flow: "P31", priority: 40 },
];
const localDate = (t: number) => new Intl.DateTimeFormat("en-CA", { timeZone: DEMO_TZ }).format(new Date(t));
const localDow = (iso: string) => new Date(`${localDate(Date.parse(iso))}T12:00:00Z`).getUTCDay();
const localHour = (t: number) => Number(new Intl.DateTimeFormat("en-GB", { timeZone: DEMO_TZ, hour: "2-digit", hourCycle: "h23" }).format(new Date(t)));
const measure = (num: number, den: number, direction: "up" | "down") =>
  ({ value: den > 0 ? Math.round((num / den) * 10_000) / 10_000 : null, numerator: num, denominator: den, status: den > 0 ? "ok" as const : "insufficient" as const, direction });
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

function uncharged(now: number): Fired | string {
  const c = demoCounts({ starts_at: new Date(now - 30 * DAY).toISOString(), ends_at: new Date(now).toISOString() }, new Date(now));
  if (c.done < 5) return "insufficient:few_completed";
  if (c.charged / c.done >= 0.9) return "quiet:covered";
  const n = c.done - c.charged;
  return {
    rule_code: "uncharged_bookings", subject_key: "last30",
    title: plural(n, "1 atendimento concluído sem cobrança registrada", `${n} atendimentos concluídos sem cobrança registrada`),
    body: "Sem a cobrança registrada, o Recebido e o fechamento do mês ficam incompletos. No Caixa, os concluídos sem cobrança aparecem juntos para marcar como recebido, cobrar depois ou usar crédito de pacote.",
    evidence: { period_start: localDate(now - 30 * DAY), period_end: localDate(now), numerator: c.charged, denominator: c.done, uncharged: n },
    action: { kind: "open", flow: "P07", label: "Abrir o Caixa", route: "/app/caixa" },
    measure: measure(c.charged, c.done, "up"),
  };
}

function noShows(now: number): Fired | string {
  const v = demoVisits().filter((x) => (x.status === "completed" || x.status === "no_show") && Date.parse(x.starts_at) >= now - 60 * DAY && Date.parse(x.starts_at) < now);
  if (v.length < 20) return "insufficient:few_outcomes";
  const ns = v.filter((x) => x.status === "no_show").length;
  if (ns === 0) return "quiet:no_no_shows";
  const rate = ns / v.length;
  const days = [0, 1, 2, 3, 4, 5, 6].map((wd) => {
    const day = v.filter((x) => localDow(x.starts_at) === wd);
    return { wd, n: day.length, k: day.filter((x) => x.status === "no_show").length };
  }).filter((d) => d.n >= 5 && d.k >= 3 && d.k / d.n >= 1.5 * rate).sort((a, b) => b.k / b.n - a.k / a.n || b.k - a.k);
  const d = days[0];
  if (!d) return "quiet:spread";
  return {
    rule_code: "no_show_concentration", subject_key: `wd${d.wd}`,
    title: `Faltas concentradas na ${WEEKDAY[d.wd]}`,
    body: `Na ${WEEKDAY[d.wd]} faltaram ${d.k} de ${d.n} atendimentos; na média dos dias, ${ns} de ${v.length}. Lembrete mais perto do horário (2 h antes) ou uma antecedência maior na política de cancelamento costumam ajudar.`,
    evidence: { period_start: localDate(now - 60 * DAY), period_end: localDate(now), numerator: d.k, denominator: d.n, weekday: d.wd, overall_no_show: ns, overall_total: v.length },
    action: { kind: "open", flow: "P13", label: "Ajustar lembretes", route: "/app/relacionamento" },
    measure: measure(ns, v.length, "down"),
  };
}

function idle(now: number): Fired | string {
  // Cinco semanas encerradas antes da semana de hoje (segunda a domingo, fuso do negócio).
  const today = Date.parse(`${localDate(now)}T12:00:00Z`);
  const monday = today - ((new Date(today).getUTCDay() + 6) % 7) * DAY;
  const from = monday - 35 * DAY;
  const visits = demoVisits().filter((x) => ["confirmed", "completed", "no_show"].includes(x.status));
  const inWindow = visits.filter((x) => { const d = Date.parse(`${localDate(Date.parse(x.starts_at))}T12:00:00Z`); return d >= from && d < monday; });
  if (inWindow.length < 10) return "insufficient:few_bookings";
  const grid: { wd: number; h: number; idle: number }[] = [];
  for (const [wdText, hours] of Object.entries(DEMO_WEEKLY_HOURS)) {
    const wd = Number(wdText);
    for (let h = 0; h < 24; h++) {
      if (!hours.open.some(([a, b]) => Number(a.slice(0, 2)) <= h && Number(b.slice(0, 2)) >= h + 1)) continue;
      let idleWeeks = 0;
      for (let k = 0; k < 5; k++) {
        const date = localDate(from + (k * 7 + ((wd + 6) % 7)) * DAY);
        const busy = inWindow.some((x) => localDate(Date.parse(x.starts_at)) === date && localHour(Date.parse(x.starts_at)) <= h && Date.parse(x.ends_at) > Date.parse(x.starts_at) && localHour(Date.parse(x.ends_at) - 1) >= h);
        if (!busy) idleWeeks++;
      }
      grid.push({ wd, h, idle: idleWeeks });
    }
  }
  const idleCells = grid.filter((g) => g.idle >= 4);
  const bands: { wd: number; h0: number; h1: number; idle: number }[] = [];
  for (const c of idleCells) {
    const last = bands[bands.length - 1];
    if (last && last.wd === c.wd && last.h1 === c.h) { last.h1 = c.h + 1; last.idle = Math.min(last.idle, c.idle); }
    else bands.push({ wd: c.wd, h0: c.h, h1: c.h + 1, idle: c.idle });
  }
  const best = bands.filter((b) => b.h1 - b.h0 >= 2).sort((a, b) => b.h1 - b.h0 - (a.h1 - a.h0) || b.idle - a.idle || (a.wd + 6) % 7 - (b.wd + 6) % 7 || a.h0 - b.h0)[0];
  const m = measure(idleCells.length, grid.length, "down");
  if (!best) return "quiet:no_idle_band";
  const svc = Object.values(DEMO_SERVICES)[0]!.name;
  return {
    rule_code: "idle_slot", subject_key: `wd${best.wd}-${best.h0}-${best.h1}`,
    title: `Horário vazio toda semana: ${WEEKDAY[best.wd]} das ${best.h0}h às ${best.h1}h`,
    body: `A faixa ficou vazia em ${best.idle} das últimas 5 semanas. Uma regra de preço só para ela (10% no ${svc}, por 4 semanas) pode atrair quem tem horário flexível. Ela nasce como proposta e só vale depois que você aprovar em Preços.`,
    evidence: { period_start: localDate(from), period_end: localDate(monday - DAY), numerator: best.idle, denominator: 5, weekday: best.wd, band_start: best.h0, band_end: best.h1, bookings_in_period: inWindow.length },
    action: { kind: "proposal", flow: "P05", operation: "pricing.propose_rule", label: "Preparar regra de preço", route: "/app/precos" },
    measure: m,
  };
}

function lapsed(now: number): Fired | string {
  const done = demoVisits().filter((x) => x.status === "completed" && x.customer_id && Date.parse(x.starts_at) < now && Date.parse(x.starts_at) >= now - 365 * DAY);
  const byCustomer = new Map<string, number[]>();
  for (const x of done) byCustomer.set(x.customer_id!, [...(byCustomer.get(x.customer_id!) ?? []), Date.parse(x.starts_at)]);
  const returning = [...byCustomer.values()].filter((t) => t.length >= 2);
  if (returning.length < 5) return "insufficient:few_returning_customers";
  const n = returning.filter((t) => now - Math.max(...t) > 60 * DAY).length;
  if (n === 0) return "quiet:all_returning";
  return {
    rule_code: "lapsed_customers", subject_key: "lapsed",
    title: plural(n, "1 cliente de retorno passou do prazo de costume", `${n} clientes de retorno passaram do prazo de costume`),
    body: "Vieram 2 vezes ou mais e já passaram do intervalo de costume do serviço (ou 60 dias quando ainda não há costume). Prepare convites de retorno: ficam como rascunho em Relacionamento para você revisar e enviar, só para quem autorizou mensagens.",
    evidence: { period_start: localDate(now - 365 * DAY), period_end: localDate(now), numerator: n, denominator: returning.length, default_days: 60 },
    action: { kind: "proposal", flow: "P13", operation: "lifecycle.draft_return", label: "Preparar convites", route: "/app/relacionamento" },
    measure: measure(n, returning.length, "down"),
  };
}

/** Uma rodada do motor no instante `now` (padrão: o "agora" fixo da demonstração). */
export function runDemoEngine(now: number = Date.parse(FIXED_NOW)): EngineResult {
  const computed: Record<string, Fired | string> = {
    uncharged_bookings: uncharged(now),
    waitlist_opening: "quiet:no_open_slot",
    no_show_concentration: noShows(now),
    package_expiring: "quiet:none_expiring",
    lapsed_customers: lapsed(now),
    idle_slot: idle(now),
    low_margin_service: "quiet:margins_ok",
    profile_incomplete: {
      rule_code: "profile_incomplete", subject_key: "profile", title: "Perfil: 3 de 4 itens prontos",
      body: "Quem chega pelo link decide mais rápido com perfil publicado, foto, preço dos serviços e o WhatsApp verificado. O próximo passo abre a tela que resolve.",
      evidence: { period_start: localDate(now), period_end: localDate(now), numerator: 3, denominator: 4, missing: ["photo"] },
      action: { kind: "open", flow: "P44", label: "Pôr uma foto", route: "/app/perfil" },
      measure: measure(3, 4, "up"),
    },
    month_closing: "quiet:not_closing",
  };
  const rules: RuleStatus[] = [];
  const fired: Fired[] = [];
  for (const r of RULES) {
    const c = computed[r.code]!;
    if (typeof c === "string") {
      const [status, reason] = c.split(":") as ["quiet" | "insufficient", string];
      rules.push({ code: r.code, title: r.title, flow: r.flow, status, reason });
    } else {
      rules.push({ code: r.code, title: r.title, flow: r.flow, status: "fire", reason: null });
      fired.push(c);
    }
  }
  return { rules, fired };
}
