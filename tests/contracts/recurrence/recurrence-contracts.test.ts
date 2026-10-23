// P20 · Coerência entre o registro v1, as rotas da função `recurrence` e as RPCs da migration.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EventType, OPERATIONS, type OperationName } from "@contracts";
import { RECURRENCE_ROUTES } from "../../../supabase/functions/recurrence/handler.ts";

const dir = new URL("../../../supabase/migrations/", import.meta.url);
const sql = readdirSync(dir).filter((f) => /^\d{14}_p20_.*\.sql$/.test(f)).map((f) => readFileSync(new URL(f, dir), "utf8")).join("\n");
function sqlParams(fn: string): string[] {
  const m = new RegExp(`create function public\\.${fn}\\(([\\s\\S]*?)\\)\\s*returns`, "m").exec(sql);
  if (!m) throw new Error(`função ${fn} não encontrada`);
  return (m[1] ?? "").split(",").map((p) => p.trim().split(/\s+/)[0] ?? "").filter(Boolean);
}
const defOf = (fn: string) => sql.slice(sql.indexOf(`create function public.${fn}(`)).split(/\nend \$\$;/)[0]!;
const ops = (Object.keys(OPERATIONS) as OperationName[]).filter((n) => OPERATIONS[n].module === "recurrence");

describe("recurrence · registro ↔ função ↔ SQL", () => {
  it("toda operação do módulo tem rota", () => {
    expect(Object.keys(RECURRENCE_ROUTES).sort()).toEqual([...ops].sort());
  });
  it.each(ops)("%s usa os mesmos schemas e o mesmo tipo do registro", (name) => {
    const r = RECURRENCE_ROUTES[name]!;
    expect(r.input).toBe(OPERATIONS[name].input);
    expect(r.output).toBe(OPERATIONS[name].output);
    expect(r.command).toBe(OPERATIONS[name].kind === "command");
  });
  it.each(Object.entries(RECURRENCE_ROUTES))("%s passa exatamente os parâmetros da RPC", (_n, r) => {
    const anything: unknown = new Proxy({}, { get: () => anything });
    const names = ["p_tenant_id", ...Object.keys(r.args(anything as never) as object)];
    if (r.command) names.push("p_idem_key", "p_request_hash", "p_request_id");
    expect(names.sort()).toEqual([...sqlParams(r.rpc)].sort());
  });
  it("RPCs do dono: SECURITY DEFINER, dono autorizado, anon revogado; renovação só do backend", () => {
    for (const r of Object.values(RECURRENCE_ROUTES)) {
      expect(sql, r.rpc).toMatch(new RegExp(`revoke all on function public\\.${r.rpc}\\([^)]*\\) from public, anon;`));
      const def = defOf(r.rpc);
      expect(def, r.rpc).toContain("security definer set search_path = ''");
      expect(def, r.rpc).toMatch(/begin\n {2}perform app\.rc_owner\(p_tenant_id\);/);
    }
    expect(sql).toMatch(/revoke all on function[^;]*app\.rc_tick\(integer\) from public, anon, authenticated;/);
  });
  it("comandos usam o nome da operação no claim de idempotência", () => {
    for (const [name, r] of Object.entries(RECURRENCE_ROUTES)) {
      if (!r.command) continue;
      expect(defOf(r.rpc), name).toContain(`app.idempotency_claim(p_tenant_id, v_uid, '${name}'`);
    }
  });
  it("evento de ciclo registrado; renovação no worker; um ciclo por número; termos com hash; ciclos append-only", () => {
    expect(EventType.options).toContain("recurrence.cycle.opened.v1");
    expect(sql).toContain("'recurrence.cycle.opened.v1'");
    expect(sql).toMatch(/create or replace function public\.jobs_run[\s\S]*app\.rc_tick\(100\)[\s\S]*app\.lc_tick\(100\)/);
    expect(sql).toContain("unique (subscription_id, cycle_no)");
    expect(sql).toContain("terms_hash text not null check (terms_hash ~ '^[0-9a-f]{64}$')");
    expect(sql).toMatch(/create trigger recurrence_cycles_append_only before update or delete on public\.recurrence_cycles/);
    expect(sql).toContain("check (cycle_days in (7, 14, 30))");
  });
});
