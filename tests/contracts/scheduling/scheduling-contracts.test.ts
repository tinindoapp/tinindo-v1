// P03 · Coerência entre o registro v1, as rotas da função `scheduling` e as RPCs da migration.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BOOKING_TRANSITIONS, BookingStatus, OPERATIONS, type OperationName } from "@contracts";
import { SCHEDULING_ROUTES } from "../../../supabase/functions/scheduling/handler.ts";

const dir = new URL("../../../supabase/migrations/", import.meta.url);
const sql = readdirSync(dir)
  .filter((f) => /^\d{14}_p03_.*\.sql$/.test(f))
  .map((f) => readFileSync(new URL(f, dir), "utf8"))
  .join("\n");

function sqlParams(fn: string): string[] {
  const m = new RegExp(`create function public\\.${fn}\\(([\\s\\S]*?)\\)\\s*returns`, "m").exec(sql);
  if (!m?.[1]) throw new Error(`função ${fn} não encontrada`);
  return m[1].split(",").map((p) => p.trim().split(/\s+/)[0] ?? "").filter(Boolean);
}

const schedulingOps = (Object.keys(OPERATIONS) as OperationName[]).filter((n) => OPERATIONS[n].module === "scheduling");

describe("scheduling · registro ↔ função", () => {
  it("toda operação do módulo no registro tem rota, e vice-versa", () => {
    expect(Object.keys(SCHEDULING_ROUTES).sort()).toEqual([...schedulingOps].sort());
  });

  it.each(schedulingOps)("%s usa os mesmos schemas e o mesmo tipo do registro", (name) => {
    const route = SCHEDULING_ROUTES[name]!;
    expect(route.input).toBe(OPERATIONS[name].input);
    expect(route.output).toBe(OPERATIONS[name].output);
    expect(route.command).toBe(OPERATIONS[name].kind === "command");
  });
});

describe("scheduling · função ↔ SQL", () => {
  it.each(Object.entries(SCHEDULING_ROUTES))("%s passa exatamente os parâmetros da RPC", (_name, route) => {
    const expected = sqlParams(route.rpc);
    const sample = new Proxy({}, { get: () => "x" });
    // Os builders só leem campos da entrada; um proxy basta para descobrir os nomes dos argumentos.
    const built = route.args(new Proxy({ window: sample, slot: sample, range: sample }, {
      get: (t, k) => (k in t ? (t as Record<string | symbol, unknown>)[k] : undefined),
    }) as never);
    expect(built).not.toBe(false);
    const names = ["p_tenant_id", ...Object.keys(built as object)];
    if (route.command) names.push("p_idem_key", "p_request_hash", "p_request_id");
    expect(names.sort()).toEqual([...expected].sort());
  });

  it("toda RPC pública revoga anon e é SECURITY DEFINER com search_path vazio", () => {
    for (const route of Object.values(SCHEDULING_ROUTES)) {
      expect(sql, route.rpc).toMatch(new RegExp(`revoke all on function public\\.${route.rpc}\\([^)]*\\) from public, anon;`));
      const def = sql.slice(sql.indexOf(`create function public.${route.rpc}(`)).split(/\nend \$\$;/)[0]!;
      expect(def, route.rpc).toContain("security definer set search_path = ''");
      expect(def, route.rpc).toMatch(/app\.is_member\(p_tenant_id/);
    }
  });

  it("comandos usam o nome da operação no claim de idempotência", () => {
    for (const [name, route] of Object.entries(SCHEDULING_ROUTES)) {
      if (!route.command) continue;
      const def = sql.slice(sql.indexOf(`create function public.${route.rpc}(`)).split(/\nend \$\$;/)[0]!;
      expect(def, name).toContain(`app.idempotency_claim(p_tenant_id, v_uid, '${name}'`);
      expect(def, name).toContain(`app.idempotency_complete(p_tenant_id, v_uid, '${name}'`);
    }
  });

  it("estados do banco = estados do contrato; capacidade bloqueada só nos ativos", () => {
    const m = /status text not null check \(status in \(([^)]*)\)\)/.exec(sql);
    expect([...(m?.[1] ?? "").matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort()).toEqual([...BookingStatus.options].sort());
    expect(sql).toContain("blocks_capacity = (status in ('held', 'confirmed', 'completed'))");
    expect(BOOKING_TRANSITIONS.held).toContain("expired");
  });
});
