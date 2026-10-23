// P13 · Coerência entre o registro v1, as rotas da função `lifecycle` e as RPCs da migration.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EventType, LifecycleRule, LifecycleStepStatus, OPERATIONS, type OperationName } from "@contracts";
import { LIFECYCLE_ROUTES } from "../../../supabase/functions/lifecycle/handler.ts";

const dir = new URL("../../../supabase/migrations/", import.meta.url);
const sql = readdirSync(dir).filter((f) => /^\d{14}_p13_.*\.sql$/.test(f)).map((f) => readFileSync(new URL(f, dir), "utf8")).join("\n");
function sqlParams(fn: string): string[] {
  const m = new RegExp(`create function public\\.${fn}\\(([\\s\\S]*?)\\)\\s*returns`, "m").exec(sql);
  if (!m) throw new Error(`função ${fn} não encontrada`);
  return (m[1] ?? "").split(",").map((p) => p.trim().split(/\s+/)[0] ?? "").filter(Boolean);
}
const defOf = (fn: string) => sql.slice(sql.indexOf(`create function public.${fn}(`)).split(/\nend \$\$;/)[0]!;
const ops = (Object.keys(OPERATIONS) as OperationName[]).filter((n) => OPERATIONS[n].module === "lifecycle");

describe("lifecycle · registro ↔ função ↔ SQL", () => {
  it("toda operação do módulo tem rota", () => {
    expect(Object.keys(LIFECYCLE_ROUTES).sort()).toEqual([...ops].sort());
  });
  it.each(ops)("%s usa os mesmos schemas e o mesmo tipo do registro", (name) => {
    const r = LIFECYCLE_ROUTES[name]!;
    expect(r.input).toBe(OPERATIONS[name].input);
    expect(r.output).toBe(OPERATIONS[name].output);
    expect(r.command).toBe(OPERATIONS[name].kind === "command");
  });
  it.each(Object.entries(LIFECYCLE_ROUTES))("%s passa exatamente os parâmetros da RPC", (_n, r) => {
    const anything: unknown = new Proxy({}, { get: () => anything });
    const names = ["p_tenant_id", ...Object.keys(r.args(anything as never) as object)];
    if (r.command) names.push("p_idem_key", "p_request_hash", "p_request_id");
    expect(names.sort()).toEqual([...sqlParams(r.rpc)].sort());
  });
  it("RPCs do dono: SECURITY DEFINER, dono autorizado, anon revogado; régua e despacho só do backend", () => {
    for (const r of Object.values(LIFECYCLE_ROUTES)) {
      expect(sql, r.rpc).toMatch(new RegExp(`revoke all on function public\\.${r.rpc}\\([^)]*\\) from public, anon;`));
      const def = defOf(r.rpc);
      expect(def, r.rpc).toContain("security definer set search_path = ''");
      expect(def, r.rpc).toMatch(/begin\n {2}perform app\.lc_owner\(p_tenant_id\);/);
    }
    expect(sql).toMatch(/revoke all on function[^;]*app\.lc_tick\(integer\) from public, anon, authenticated;/);
    expect(sql).toMatch(/revoke all on function[^;]*app\.lc_dispatch\(public\.lifecycle_steps\)[^;]*from public, anon, authenticated;/);
  });
  it("comandos usam o nome da operação no claim de idempotência", () => {
    for (const [name, r] of Object.entries(LIFECYCLE_ROUTES)) {
      if (!r.command) continue;
      expect(defOf(r.rpc), name).toContain(`app.idempotency_claim(p_tenant_id, v_uid, '${name}'`);
    }
  });
  it("réguas e estados = contrato; evento de remarcação registrado; o worker roda a régua; consumidor idempotente", () => {
    expect(sql).toContain("check (rule in ('confirmation', 'reminder', 'quote_followup', 'receivable_reminder', 'reactivation'))");
    expect([...LifecycleRule.options].sort()).toEqual(["confirmation", "quote_followup", "reactivation", "receivable_reminder", "reminder"]);
    expect(sql).toContain("check (status in ('scheduled', 'deferred', 'sent', 'manual', 'shared', 'skipped', 'cancelled'))");
    expect([...LifecycleStepStatus.options].sort()).toEqual(["cancelled", "deferred", "manual", "scheduled", "sent", "shared", "skipped"]);
    expect(EventType.options).toContain("booking.rescheduled.v1");
    expect(sql).toContain("'booking.rescheduled.v1'");
    expect(sql).toMatch(/create or replace function public\.jobs_run[\s\S]*app\.lc_tick\(100\)/);
    expect(sql).toContain("insert into public.lifecycle_processed_events (event_id) values (e.event_id) on conflict do nothing");
    expect(sql).toContain("unique (tenant_id, rule, aggregate_id, step_key)");
    expect(sql).not.toMatch(/grant select[^;]*lifecycle_processed_events[^;]*to authenticated/);
  });
});
