// P22/P45 · Coerência entre o registro v1, as rotas da função `growth-advice` e as RPCs das migrations; invariantes.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AdviceOutcome, EventType, GoalMetricKey, InsightAction, InsightRuleCode, MetricKey, OPERATIONS, type OperationName } from "@contracts";
import { GROWTH_ADVICE_ROUTES } from "../../../supabase/functions/growth-advice/handler.ts";

const dir = new URL("../../../supabase/migrations/", import.meta.url);
const sql = readdirSync(dir).filter((f) => /^\d{14}_p(22|45)_.*\.sql$/.test(f)).map((f) => readFileSync(new URL(f, dir), "utf8")).join("\n");
const p45 = readdirSync(dir).filter((f) => /^\d{14}_p45_.*\.sql$/.test(f)).map((f) => readFileSync(new URL(f, dir), "utf8")).join("\n");
function sqlParams(fn: string): string[] {
  const m = new RegExp(`create function public\\.${fn}\\(([\\s\\S]*?)\\)\\s*returns`, "m").exec(sql);
  if (!m) throw new Error(`função ${fn} não encontrada`);
  return (m[1] ?? "").split(",").map((p) => p.trim().split(/\s+/)[0] ?? "").filter(Boolean);
}
const defOf = (fn: string) => sql.slice(sql.indexOf(`create function public.${fn}(`)).split(/\nend \$\$;/)[0]!;
const ops = (Object.keys(OPERATIONS) as OperationName[]).filter((n) => OPERATIONS[n].module === "growth-advice");

describe("growth-advice · registro ↔ função ↔ SQL", () => {
  it("toda operação do módulo tem rota", () => {
    expect(Object.keys(GROWTH_ADVICE_ROUTES).sort()).toEqual([...ops].sort());
  });
  it.each(ops)("%s usa os mesmos schemas e o mesmo tipo do registro", (name) => {
    const r = GROWTH_ADVICE_ROUTES[name]!;
    expect(r.input).toBe(OPERATIONS[name].input);
    expect(r.output).toBe(OPERATIONS[name].output);
    expect(r.command).toBe(OPERATIONS[name].kind === "command");
  });
  it.each(Object.entries(GROWTH_ADVICE_ROUTES))("%s passa exatamente os parâmetros da RPC", (_n, r) => {
    const anything: unknown = new Proxy({}, { get: () => anything });
    const names = ["p_tenant_id", ...Object.keys(r.args(anything as never) as object)];
    if (r.command) names.push("p_idem_key", "p_request_hash", "p_request_id");
    expect(names.sort()).toEqual([...sqlParams(r.rpc)].sort());
  });
  it("RPCs do dono: SECURITY DEFINER, dono autorizado, anon revogado; acompanhamento só do backend", () => {
    for (const r of Object.values(GROWTH_ADVICE_ROUTES)) {
      expect(sql, r.rpc).toMatch(new RegExp(`revoke all on function public\\.${r.rpc}\\([^)]*\\) from public, anon;`));
      const def = defOf(r.rpc);
      expect(def, r.rpc).toContain("security definer set search_path = ''");
      expect(def, r.rpc).toMatch(/begin\n {2}perform app\.ga_owner\(p_tenant_id\);/);
    }
    expect(sql).toMatch(/revoke all on function[^;]*app\.ga_tick\(integer\)[^;]*from public, anon, authenticated;/);
  });
  it("comandos usam o nome da operação no claim de idempotência", () => {
    for (const [name, r] of Object.entries(GROWTH_ADVICE_ROUTES)) {
      if (!r.command) continue;
      expect(defOf(r.rpc), name).toContain(`app.idempotency_claim(p_tenant_id, v_uid, '${name}'`);
    }
  });
  it("metas só sobre indicadores do P18; sugestões por regra (sem LLM) e sem efeito; publicação só pelo escopo do P09", () => {
    for (const k of GoalMetricKey.options) expect(MetricKey.options).toContain(k);
    expect(GoalMetricKey.options).not.toContain("human_minutes");
    expect(sql).toMatch(/app\.an_metrics\(p_tenant_id, lower\(p_range\), upper\(p_range\)\)/);
    expect(sql).not.toMatch(/openai|anthropic|embedding|gpt|pg_net|extensions\.http|net\.http/i);
    expect(AdviceOutcome.options.join(" ")).not.toMatch(/caus|effect|efeito/i);
    expect(sql).toContain("if not found or v_profile.published_at is null or not ('bio' = any (v_profile.public_fields)) then");
    expect(sql).toMatch(/'bio', case when 'bio' = any \(p\.public_fields\) then \(select c\.body from public\.profile_contents c where c\.tenant_id = p\.tenant_id\) end/);
    expect(sql).toContain("insert into public.content_templates (code, profession, kind, title, body) values");
    expect(sql).toMatch(/create or replace function public\.jobs_run[\s\S]*app\.ga_tick\(100\)/);
    expect(EventType.options).toContain("content.published.v1");
  });
  it("P45: nove regras = contrato; motor no worker uma vez por dia; upsert por regra e assunto; sem LLM; ação só como proposta", () => {
    const codes = [...p45.matchAll(/^ {2}\('([a-z_]+)', '[^']+', 'P\d\d', '(proposal|open|none)'/gm)].map((m) => m[1]);
    expect(codes.sort()).toEqual([...InsightRuleCode.options].sort());
    for (const c of InsightRuleCode.options) expect(p45).toContain(`when '${c}' then app.gi_${c}(p_tenant_id, p_now)`);
    expect(p45).toMatch(/create or replace function public\.jobs_run[\s\S]*app\.ga_tick\(100\)[\s\S]*app\.lc_tick\(100\)[\s\S]*app\.gi_tick\(20\)/);
    expect(p45).toContain("primary key (tenant_id, run_date)");
    expect(p45).toContain("unique (tenant_id, rule_code, subject_key)");
    expect(p45).toContain("on conflict (tenant_id, rule_code, subject_key) do update set");
    expect(p45).toContain("insert into public.insight_runs (tenant_id, run_date) values (t.id, t.d) on conflict do nothing returning true into v_claimed;");
    expect(p45).toContain("check (evidence ?& array['period_start', 'period_end', 'numerator', 'denominator'])");
    expect(p45).not.toMatch(/openai|anthropic|embedding|gpt|pg_net|extensions\.http|net\.http/i);
    // Proposta, nunca execução: preço nasce inativo no P05; mensagens nascem como rascunho manual no P13.
    expect(p45).not.toMatch(/pricing_approve_rule|pricing_publish_rule|channel_send|lifecycle_campaign_approve|lc_dispatch\(/);
    expect(p45.match(/'manual', '(reativacao|pacote_vencendo)'/g)).toHaveLength(2);
    expect(InsightAction.shape.operation.unwrap().options.sort()).toEqual(["lifecycle.draft_package", "lifecycle.draft_return", "pricing.propose_rule"]);
    // A regra de cobrança saiu do P22 e foi para o motor.
    const gaRules = p45.slice(p45.indexOf("create or replace function app.ga_rules(")).split(/\nend \$\$;/)[0]!;
    expect(gaRules).not.toContain("charge_coverage");
    expect(p45).toMatch(/revoke all on function[^;]*app\.gi_tick\(integer, timestamptz\)[^;]*from public, anon, authenticated;/);
  });
});
