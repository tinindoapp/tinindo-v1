// P18 · Coerência entre o registro v1, as rotas da função `analytics` e as RPCs da migration.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MetricKey, OPERATIONS, type OperationName } from "@contracts";
import { ANALYTICS_ROUTES } from "../../../supabase/functions/analytics/handler.ts";

const dir = new URL("../../../supabase/migrations/", import.meta.url);
const sql = readdirSync(dir)
  .filter((f) => /^\d{14}_p18_.*\.sql$/.test(f))
  .map((f) => readFileSync(new URL(f, dir), "utf8"))
  .join("\n");
function sqlParams(fn: string): string[] {
  const m = new RegExp(`create function public\\.${fn}\\(([\\s\\S]*?)\\)\\s*returns`, "m").exec(sql);
  if (!m) throw new Error(`função ${fn} não encontrada`);
  return (m[1] ?? "").split(",").map((p) => p.trim().split(/\s+/)[0] ?? "").filter(Boolean);
}
const defOf = (fn: string) => sql.slice(sql.indexOf(`create function public.${fn}(`)).split(/\nend \$\$;/)[0]!;
const anything: unknown = new Proxy({}, { get: () => anything });
const ops = (Object.keys(OPERATIONS) as OperationName[]).filter((n) => OPERATIONS[n].module === "analytics");

describe("analytics · registro ↔ função ↔ SQL", () => {
  it("toda operação do módulo no registro tem rota, e vice-versa", () => {
    expect(Object.keys(ANALYTICS_ROUTES).sort()).toEqual([...ops].sort());
  });
  it.each(ops)("%s usa os mesmos schemas e o mesmo tipo do registro", (name) => {
    const r = ANALYTICS_ROUTES[name]!;
    expect(r.input).toBe(OPERATIONS[name].input);
    expect(r.output).toBe(OPERATIONS[name].output);
    expect(r.command).toBe(OPERATIONS[name].kind === "command");
  });
  it.each(Object.entries(ANALYTICS_ROUTES))("%s passa exatamente os parâmetros da RPC", (_n, r) => {
    const names = [...(r.tenant === false ? [] : ["p_tenant_id"]), ...Object.keys(r.args(anything as never) as object)];
    if (r.command) names.push("p_idem_key", "p_request_hash", "p_request_id");
    expect(names.sort()).toEqual([...sqlParams(r.rpc)].sort());
  });
  it("RPCs revogam anon, são SECURITY DEFINER e autorizam antes de calcular", () => {
    for (const [name, r] of Object.entries(ANALYTICS_ROUTES)) {
      expect(sql, r.rpc).toMatch(new RegExp(`revoke all on function public\\.${r.rpc}\\([^)]*\\) from public, anon;`));
      const def = defOf(r.rpc);
      expect(def, r.rpc).toContain("security definer set search_path = ''");
      const gate = name === "analytics.cost_to_serve" ? /begin\n {2}v_op := app\.svc_operator\(\);/ : /begin\n {2}perform app\.an_owner\(p_tenant_id\);/;
      expect(def, r.rpc).toMatch(gate);
    }
  });
  it("todo indicador do contrato é calculado no banco; causalidade é fixa", () => {
    for (const k of MetricKey.options) expect(sql, k).toContain(`app.an_metric('${k}'`);
    expect(defOf("analytics_metrics")).toContain("'causality', 'not_established'");
  });
  it("baseline é append-only e só com período encerrado", () => {
    expect(sql).toMatch(/create trigger analytics_baselines_append_only before update or delete on public\.analytics_baselines/);
    expect(defOf("analytics_baseline_create")).toContain("if p_to > clock_timestamp() then");
  });
});
