// P05 · Coerência entre o registro v1, as rotas da função `pricing` e as RPCs da migration.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { OPERATIONS, type OperationName } from "@contracts";
import { PRICE_FIXTURES } from "../../../supabase/functions/_shared/domain/pricing/price.ts";
import { PRICING_ROUTES } from "../../../supabase/functions/pricing/handler.ts";

const dir = new URL("../../../supabase/migrations/", import.meta.url);
const tests = readFileSync(new URL("../../../supabase/tests/database/06_pricing.test.sql", import.meta.url), "utf8");
const sql = readdirSync(dir)
  .filter((f) => /^\d{14}_p05_.*\.sql$/.test(f))
  .map((f) => readFileSync(new URL(f, dir), "utf8"))
  .join("\n");

function sqlParams(fn: string): string[] {
  const m = new RegExp(`create function public\\.${fn}\\(([\\s\\S]*?)\\)\\s*returns`, "m").exec(sql);
  if (!m?.[1]) throw new Error(`função ${fn} não encontrada`);
  return m[1].split(",").map((p) => p.trim().split(/\s+/)[0] ?? "").filter(Boolean);
}

const pricingOps = (Object.keys(OPERATIONS) as OperationName[]).filter((n) => OPERATIONS[n].module === "pricing");

describe("pricing · registro ↔ função", () => {
  it("toda operação do módulo no registro tem rota, e vice-versa", () => {
    expect(Object.keys(PRICING_ROUTES).sort()).toEqual([...pricingOps].sort());
  });

  it.each(pricingOps)("%s usa os mesmos schemas e o mesmo tipo do registro", (name) => {
    const route = PRICING_ROUTES[name]!;
    expect(route.input).toBe(OPERATIONS[name].input);
    expect(route.output).toBe(OPERATIONS[name].output);
    expect(route.command).toBe(OPERATIONS[name].kind === "command");
  });
});

describe("pricing · função ↔ SQL", () => {
  it.each(Object.entries(PRICING_ROUTES))("%s passa exatamente os parâmetros da RPC", (_name, route) => {
    const expected = sqlParams(route.rpc);
    // Os builders só leem campos da entrada; um proxy que responde a qualquer campo revela os argumentos.
    const anything: unknown = new Proxy({}, { get: (_t, k) => (k === "cursor" ? undefined : anything) });
    const built = route.args(anything as never);
    expect(built).not.toBe(false);
    const names = ["p_tenant_id", ...Object.keys(built as object)];
    if (route.command) names.push("p_idem_key", "p_request_hash", "p_request_id");
    expect(names.sort()).toEqual([...expected].sort());
  });

  it("toda RPC pública revoga anon e é SECURITY DEFINER com search_path vazio", () => {
    for (const route of Object.values(PRICING_ROUTES)) {
      expect(sql, route.rpc).toMatch(new RegExp(`revoke all on function public\\.${route.rpc}\\([^)]*\\) from public, anon;`));
      const def = sql.slice(sql.indexOf(`create function public.${route.rpc}(`)).split(/\nend \$\$;/)[0]!;
      expect(def, route.rpc).toContain("security definer set search_path = ''");
      expect(def, route.rpc).toMatch(/app\.is_member\(p_tenant_id, array\['owner'\]\)/);
    }
  });

  it("comandos usam o nome da operação no claim de idempotência", () => {
    for (const [name, route] of Object.entries(PRICING_ROUTES)) {
      if (!route.command) continue;
      const def = sql.slice(sql.indexOf(`create function public.${route.rpc}(`)).split(/\nend \$\$;/)[0]!;
      expect(def, name).toContain(`app.idempotency_claim(p_tenant_id, v_uid, '${name}'`);
      expect(def, name).toContain(`app.idempotency_complete(p_tenant_id, v_uid, '${name}'`);
    }
  });

  it("cálculo do banco usa as mesmas fixtures do domínio TS", () => {
    for (const f of PRICE_FIXTURES) {
      const i = f.input;
      const args = [i.base_cents, i.manual_floor_cents, i.estimated_cost_cents ?? "null", i.fee_bps ?? "null", i.target_margin_bps,
        i.discount_bps, i.max_discount_bps].join(", ");
      expect(tests, f.name).toContain(`app.price_compute(${args})`);
    }
  });

  it("publicação exige aprovação válida e trava o serviço", () => {
    const def = sql.slice(sql.indexOf("create function public.pricing_publish_rule(")).split(/\nend \$\$;/)[0]!;
    expect(def).toContain("v_a.payload_hash <> v_p.payload_hash");
    expect(def).toContain("v_a.used_at is not null");
    expect(def).toMatch(/provider_services s where[^;]*for update;/);
  });
});
