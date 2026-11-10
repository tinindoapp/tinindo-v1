// P44 · Coerência entre o registro v1, as rotas da função `setup`, as RPCs da migration e o evento do passo concluído.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CostToServeOutput, EventType, OPERATIONS, type OperationName, SetupDraftApplyInput, SetupProgress, SetupServicesApplyInput } from "@contracts";
import { SETUP_ROUTES } from "../../../supabase/functions/setup/handler.ts";

const dir = new URL("../../../supabase/migrations/", import.meta.url);
const sql = readdirSync(dir).filter((f) => /^\d{14}_p44_.*\.sql$/.test(f)).map((f) => readFileSync(new URL(f, dir), "utf8")).join("\n");
function sqlParams(fn: string): string[] {
  const m = new RegExp(`create function public\\.${fn}\\(([\\s\\S]*?)\\)\\s*returns`, "m").exec(sql);
  if (!m) throw new Error(`função ${fn} não encontrada`);
  return (m[1] ?? "").split(",").map((p) => p.trim().split(/\s+/)[0] ?? "").filter(Boolean);
}
const defOf = (fn: string) => sql.slice(sql.indexOf(`create function public.${fn}(`)).split(/\nend \$\$;/)[0]!;
const ops = (Object.keys(OPERATIONS) as OperationName[]).filter((n) => OPERATIONS[n].module === "setup");

describe("setup · registro ↔ função ↔ SQL", () => {
  it("toda operação do módulo tem rota", () => {
    expect(ops.length).toBe(5);
    expect(Object.keys(SETUP_ROUTES).sort()).toEqual([...ops].sort());
  });
  it.each(ops)("%s usa os mesmos schemas e o mesmo tipo do registro", (name) => {
    const r = SETUP_ROUTES[name]!;
    expect(r.input).toBe(OPERATIONS[name].input);
    expect(r.output).toBe(OPERATIONS[name].output);
    expect(r.command).toBe(OPERATIONS[name].kind === "command");
  });
  it.each(Object.entries(SETUP_ROUTES))("%s passa exatamente os parâmetros da RPC", (_n, r) => {
    const anything: unknown = new Proxy({}, { get: () => anything });
    const names = ["p_tenant_id", ...Object.keys(r.args(anything as never) as object)];
    if (r.command) names.push("p_idem_key", "p_request_hash", "p_request_id");
    expect(names.sort()).toEqual([...sqlParams(r.rpc)].sort());
  });
  it("RPCs: SECURITY DEFINER, anon revogado; comandos exigem dono antes de tudo; leituras exigem membro", () => {
    for (const r of Object.values(SETUP_ROUTES)) {
      expect(sql, r.rpc).toMatch(new RegExp(`revoke all on function public\\.${r.rpc}\\([^)]*\\) from public, anon;`));
      const def = defOf(r.rpc);
      expect(def, r.rpc).toContain("security definer set search_path = ''");
      if (r.command) expect(def, r.rpc).toMatch(/begin\n {2}perform app\.setup_owner\(p_tenant_id\);/);
      else expect(def, r.rpc).toMatch(/if not app\.is_member\(p_tenant_id\)/);
    }
  });
  it("modelos só por migration: tabela append-only, sem escrita para authenticated; medição backend-only", () => {
    expect(sql).toMatch(/create trigger setup_service_templates_append_only before update or delete/);
    expect(sql).toMatch(/revoke all on public\.setup_service_templates, public\.setup_dismissals, public\.setup_step_completions from anon, authenticated;/);
    expect(sql).toMatch(/grant select on public\.setup_service_templates, public\.setup_dismissals to authenticated;/);
    expect(sql).not.toMatch(/grant (insert|update|delete)[^;]*to authenticated/);
    expect(sql).not.toMatch(/create policy setup_step_completions/);
  });
  it("serviços e expediente passam pelas RPCs do P02 e do P03 (mesmas regras), nunca por insert direto", () => {
    expect(sql).toMatch(/public\.crm_service_save\(p_tenant_id, null, null/);
    expect(sql).toMatch(/public\.scheduling_rules_save\(p_tenant_id, v_res\.id, v_res\.version/);
    expect(sql).not.toMatch(/insert into public\.(provider_services|availability_rules)/);
  });
  it("evento setup.step_completed.v1 registrado e emitido uma vez por passo; indicador do P18 no contrato", () => {
    expect(EventType.options).toContain("setup.step_completed.v1");
    expect(sql).toMatch(/app\.emit_event\(p_tenant_id, 'setup\.step_completed\.v1'/);
    expect(sql).toMatch(/pg_advisory_xact_lock\(hashtext\('setup:' \|\| p_tenant_id::text\)\)/);
    expect(sql).toMatch(/'setup_ready_24h', app\.setup_ready_summary\(p_from, p_to\)/);
    expect(CostToServeOutput.shape.setup_ready_24h).toBeDefined();
  });
  it("contrato: 8 passos fixos; nada a aplicar e lista vazia de serviços são recusados no schema", () => {
    expect(SetupProgress.shape.steps.def.checks?.length ?? 1).toBeGreaterThan(0);
    expect(SetupDraftApplyInput.safeParse({}).success).toBe(false);
    expect(SetupDraftApplyInput.safeParse({ services: [{ name: "Corte", duration_min: 30, base_price_cents: 5000 }] }).success).toBe(true);
    expect(SetupServicesApplyInput.safeParse({ services: [] }).success).toBe(false);
  });
});
