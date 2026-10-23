// P19 · Coerência entre o registro v1, as rotas da função `campaigns` e as RPCs da migration; invariantes do desenho.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CampaignVerdict, EventType, OPERATIONS, type OperationName } from "@contracts";
import { CAMPAIGNS_ROUTES } from "../../../supabase/functions/campaigns/handler.ts";

const dir = new URL("../../../supabase/migrations/", import.meta.url);
const sql = readdirSync(dir).filter((f) => /^\d{14}_p19_.*\.sql$/.test(f)).map((f) => readFileSync(new URL(f, dir), "utf8")).join("\n");
function sqlParams(fn: string): string[] {
  const m = new RegExp(`create function public\\.${fn}\\(([\\s\\S]*?)\\)\\s*returns`, "m").exec(sql);
  if (!m) throw new Error(`função ${fn} não encontrada`);
  return (m[1] ?? "").split(",").map((p) => p.trim().split(/\s+/)[0] ?? "").filter(Boolean);
}
const defOf = (fn: string) => sql.slice(sql.indexOf(`create function public.${fn}(`)).split(/\nend \$\$;/)[0]!;
const ops = (Object.keys(OPERATIONS) as OperationName[]).filter((n) => OPERATIONS[n].module === "campaigns");

describe("campaigns · registro ↔ função ↔ SQL", () => {
  it("toda operação do módulo tem rota", () => {
    expect(Object.keys(CAMPAIGNS_ROUTES).sort()).toEqual([...ops].sort());
  });
  it.each(ops)("%s usa os mesmos schemas e o mesmo tipo do registro", (name) => {
    const r = CAMPAIGNS_ROUTES[name]!;
    expect(r.input).toBe(OPERATIONS[name].input);
    expect(r.output).toBe(OPERATIONS[name].output);
    expect(r.command).toBe(OPERATIONS[name].kind === "command");
  });
  it.each(Object.entries(CAMPAIGNS_ROUTES))("%s passa exatamente os parâmetros da RPC", (_n, r) => {
    const anything: unknown = new Proxy({}, { get: () => anything });
    const names = ["p_tenant_id", ...Object.keys(r.args(anything as never) as object)];
    if (r.command) names.push("p_idem_key", "p_request_hash", "p_request_id");
    expect(names.sort()).toEqual([...sqlParams(r.rpc)].sort());
  });
  it("RPCs do dono: SECURITY DEFINER, dono autorizado, anon revogado; fechamento só do backend", () => {
    for (const r of Object.values(CAMPAIGNS_ROUTES)) {
      expect(sql, r.rpc).toMatch(new RegExp(`revoke all on function public\\.${r.rpc}\\([^)]*\\) from public, anon;`));
      const def = defOf(r.rpc);
      expect(def, r.rpc).toContain("security definer set search_path = ''");
      expect(def, r.rpc).toMatch(/begin\n {2}perform app\.cp_owner\(p_tenant_id\);/);
    }
    expect(sql).toMatch(/revoke all on function[^;]*app\.cp_tick\(integer\) from public, anon, authenticated;/);
  });
  it("comandos usam o nome da operação no claim de idempotência", () => {
    for (const [name, r] of Object.entries(CAMPAIGNS_ROUTES)) {
      if (!r.command) continue;
      expect(defOf(r.rpc), name).toContain(`app.idempotency_claim(p_tenant_id, v_uid, '${name}'`);
    }
  });
  it("desenho: público só com consentimento; controle sorteado no servidor; tetos no servidor; sem controle = observação; braço append-only", () => {
    expect(EventType.options).toEqual(expect.arrayContaining(["campaign.approved.v1", "campaign.closed.v1"]));
    expect(sql).toMatch(/app\.lc_denied\(p_tenant_id, cu\.id, 'marketing'\) is null/);
    expect(sql).toMatch(/order by md5\(v_c\.id::text \|\| \(x->>'customer_id'\)\)/);
    expect(sql).toContain("v_treat := least(v_n - v_control, p_max_sends);");
    expect(sql).toContain("v_treat := least(v_treat, (p_spend_cap_cents / v_unit)::integer);");
    expect(sql).toMatch(/case when p_c\.control_pct > 0 then 'randomized_control' else 'observational' end/);
    expect(sql).toContain("v_verdict := 'observation_only';");
    expect(sql).toMatch(/create trigger campaign_members_append_only before update or delete on public\.campaign_members/);
    expect(sql).toMatch(/create or replace function public\.jobs_run[\s\S]*app\.cp_tick\(100\)/);
    expect(sql).toMatch(/rule in \('reactivation', 'campaign'\) then 'marketing'/);
    // Vereditos possíveis não incluem causa: só diferença detectada/não detectada, inconclusivo ou observação.
    expect(CampaignVerdict.options.join(" ")).not.toMatch(/caus|effect|efeito/i);
  });
});
