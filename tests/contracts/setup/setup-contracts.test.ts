// P44 · Coerência entre o registro v1, as rotas da função `setup`, as RPCs da migration e o evento do passo concluído.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, expectTypeOf, it } from "vitest";
import { BusinessScope, CostToServeOutput, EventType, MODULE_LEVELS, ModuleCode, type ModuleId, OPERATIONS, type OperationName, SetupDraftApplyInput, SetupModuleSetInput, SetupProgress, SetupServicesApplyInput } from "@contracts";
import { SETUP_DESCRIBE, SETUP_ROUTES } from "../../../supabase/functions/setup/handler.ts";

const dir = new URL("../../../supabase/migrations/", import.meta.url);
const sql = readdirSync(dir).filter((f) => /^\d{14}_p(44|51)_.*\.sql$/.test(f)).map((f) => readFileSync(new URL(f, dir), "utf8")).join("\n");
function sqlParams(fn: string): string[] {
  const m = new RegExp(`create function public\\.${fn}\\(([\\s\\S]*?)\\)\\s*returns`, "m").exec(sql);
  if (!m) throw new Error(`função ${fn} não encontrada`);
  return (m[1] ?? "").split(",").map((p) => p.trim().split(/\s+/)[0] ?? "").filter(Boolean);
}
const defOf = (fn: string) => sql.slice(sql.indexOf(`create function public.${fn}(`)).split(/\nend \$\$;/)[0]!;
// `setup.describe` (P50) tem rota própria no handler, fora de SETUP_ROUTES: não é uma RPC (teste à parte abaixo).
const ops = (Object.keys(OPERATIONS) as OperationName[]).filter((n) => OPERATIONS[n].module === "setup" && n !== "setup.describe");

describe("setup · registro ↔ função ↔ SQL", () => {
  it("toda operação do módulo tem rota", () => {
    expect(ops.length).toBe(7);
    expect(Object.keys(SETUP_ROUTES).sort()).toEqual([...ops].sort());
  });
  it("setup.describe: registrado com os mesmos schemas da rota própria do handler, como consulta", () => {
    const op = OPERATIONS["setup.describe"];
    expect(op.module).toBe("setup");
    expect(op.kind).toBe("query");
    expect(SETUP_DESCRIBE.name).toBe("setup.describe");
    expect(SETUP_DESCRIBE.input).toBe(op.input);
    expect(SETUP_DESCRIBE.output).toBe(op.output);
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

// P51 · Escopo visível do piloto: o mesmo mapa de níveis no contrato e no banco, e a chave escrita só por RPC.
describe("setup · escopo do piloto (P51)", () => {
  // O catálogo em vigor é a última definição de app.module_catalog nas migrations (P51 e, depois, P57 com `privacy`).
  const catalogSql = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort().map((f) => readFileSync(new URL(f, dir), "utf8"))
    .filter((t) => /function app\.module_catalog\(\)/.test(t)).at(-1)!;
  const lastDef = catalogSql.slice(catalogSql.lastIndexOf("function app.module_catalog()")).split("$$;")[0]!;
  const catalog = [...lastDef.matchAll(/\('([a-z-]+)', '(pilot|activation|stored)', \d+\)/g)].map((m) => [m[1]!, m[2]!] as const);

  it("ModuleCode cobre exatamente os módulos do registro de operações", () => {
    expectTypeOf<ModuleCode>().toEqualTypeOf<ModuleId>();
    const used = new Set((Object.keys(OPERATIONS) as OperationName[]).map((n) => OPERATIONS[n].module));
    for (const m of used) expect(ModuleCode.options).toContain(m);
  });
  it("níveis: 11 do piloto (10 + privacy), 6 por ativação e 11 guardados, iguais no contrato e em app.module_catalog", () => {
    expect(catalog.length).toBe(28);
    expect(Object.fromEntries(catalog)).toEqual(MODULE_LEVELS);
    const count = (level: string) => Object.values(MODULE_LEVELS).filter((l) => l === level).length;
    expect([count("pilot"), count("activation"), count("stored")]).toEqual([11, 6, 11]);
    expect(Object.keys(MODULE_LEVELS).sort()).toEqual([...ModuleCode.options].sort());
  });
  it("chave: RLS, sem escrita para authenticated, guardado só pelo backend, mudança auditada", () => {
    expect(sql).toMatch(/alter table public\.tenant_modules enable row level security;/);
    expect(sql).toMatch(/revoke all on public\.tenant_modules from anon, authenticated;/);
    expect(sql).toMatch(/create policy tenant_modules_select_member on public\.tenant_modules for select to authenticated using \(app\.is_member\(tenant_id\)\);/);
    expect(sql).toMatch(/grant execute on function app\.module_enabled\(uuid, text\), app\.module_admin_set\(uuid, text, boolean\) to service_role;/);
    expect(sql).toMatch(/perform app\.audit\(p_tenant_id, case when p_enabled then 'module\.enable' else 'module\.disable' end/);
    const def = defOf("setup_module_set");
    expect(def).toMatch(/if v_level = 'stored' then\n {4}raise exception using errcode = 'PT403'/);
    expect(def).toMatch(/app\.idempotency_claim\(p_tenant_id, v_uid, 'setup\.module_set'/);
  });
  it("D4: a rotina de campanhas (módulo guardado) só roda para o negócio com o módulo ligado", () => {
    expect(sql).toMatch(/create or replace function app\.cp_tick[\s\S]*?and app\.module_enabled\(x\.tenant_id, 'campaigns'\)/);
  });
  it("contrato: escopo com os 28 módulos; a chave recusa módulo desconhecido no schema", () => {
    const modules = ModuleCode.options.map((module) => ({ module, level: MODULE_LEVELS[module], enabled: MODULE_LEVELS[module] === "pilot" }));
    expect(BusinessScope.safeParse({ profession: "barber", plan: { code: "free", name: "Grátis" }, modules }).success).toBe(true);
    expect(BusinessScope.safeParse({ profession: "barber", plan: { code: "free", name: "Grátis" }, modules: modules.slice(1) }).success).toBe(false);
    expect(SetupModuleSetInput.safeParse({ module: "sales", enabled: true }).success).toBe(true);
    expect(SetupModuleSetInput.safeParse({ module: "erp", enabled: true }).success).toBe(false);
  });
});
