// P07 · Coerência entre o registro v1, as rotas da função `finance` e as RPCs da migration.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ExpenseCategory, OPERATIONS, type OperationName, PaymentMethod, ReceivableStatus } from "@contracts";
import { FINANCE_ROUTES } from "../../../supabase/functions/finance/handler.ts";

const dir = new URL("../../../supabase/migrations/", import.meta.url);
const sql = readdirSync(dir)
  .filter((f) => /^\d{14}_p07_.*\.sql$/.test(f))
  .map((f) => readFileSync(new URL(f, dir), "utf8"))
  .join("\n");

function sqlParams(fn: string): string[] {
  const m = new RegExp(`create function public\\.${fn}\\(([\\s\\S]*?)\\)\\s*returns`, "m").exec(sql);
  if (!m?.[1]) throw new Error(`função ${fn} não encontrada`);
  return m[1].split(",").map((p) => p.trim().split(/\s+/)[0] ?? "").filter(Boolean);
}

const financeOps = (Object.keys(OPERATIONS) as OperationName[]).filter((n) => OPERATIONS[n].module === "finance");

describe("finance · registro ↔ função", () => {
  it("toda operação do módulo no registro tem rota, e vice-versa", () => {
    expect(Object.keys(FINANCE_ROUTES).sort()).toEqual([...financeOps].sort());
  });

  it.each(financeOps)("%s usa os mesmos schemas e o mesmo tipo do registro", (name) => {
    const route = FINANCE_ROUTES[name]!;
    expect(route.input).toBe(OPERATIONS[name].input);
    expect(route.output).toBe(OPERATIONS[name].output);
    expect(route.command).toBe(OPERATIONS[name].kind === "command");
  });
});

describe("finance · função ↔ SQL", () => {
  it.each(Object.entries(FINANCE_ROUTES))("%s passa exatamente os parâmetros da RPC", (_name, route) => {
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
    for (const route of Object.values(FINANCE_ROUTES)) {
      expect(sql, route.rpc).toMatch(new RegExp(`revoke all on function public\\.${route.rpc}\\([^)]*\\) from public, anon;`));
      const def = sql.slice(sql.indexOf(`create function public.${route.rpc}(`)).split(/\nend \$\$;/)[0]!;
      expect(def, route.rpc).toContain("security definer set search_path = ''");
      expect(def, route.rpc).toMatch(/app\.fin_owner\(p_tenant_id\)/);
    }
  });

  it("comandos usam o nome da operação no claim de idempotência", () => {
    for (const [name, route] of Object.entries(FINANCE_ROUTES)) {
      if (!route.command) continue;
      const def = sql.slice(sql.indexOf(`create function public.${route.rpc}(`)).split(/\nend \$\$;/)[0]!;
      expect(def, name).toContain(`app.idempotency_claim(p_tenant_id, v_uid, '${name}'`);
      expect(def, name).toContain(`app.idempotency_complete(p_tenant_id, v_uid, '${name}'`);
    }
  });

  it("estados e métodos do banco = contrato; recebimento só manual", () => {
    const list = (col: string) => {
      const m = new RegExp(`${col} text not null[^,]*check \\(${col} in \\(([^)]*)\\)\\)`).exec(sql);
      return [...(m?.[1] ?? "").matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort();
    };
    expect(list("method")).toEqual([...PaymentMethod.options].sort());
    expect(list("category")).toEqual([...ExpenseCategory.options].sort());
    expect(sql).toContain("check (status in ('open', 'partially_paid', 'paid', 'cancelled'))");
    expect([...ReceivableStatus.options].sort()).toEqual(["cancelled", "open", "paid", "partially_paid"]);
    expect(sql).toContain("source text not null default 'manual' check (source = 'manual')");
  });

  it("recebimentos, despesas e ledger de créditos são append-only", () => {
    for (const t of ["payment_entries", "expense_entries", "session_entries"]) {
      expect(sql).toMatch(new RegExp(`create trigger ${t}_append_only before update or delete on public\\.${t}`));
    }
  });

  it("leitura do caixa é só do dono (RLS)", () => {
    const policies = [...sql.matchAll(/create policy \w+ on public\.(\w+)\s+for select to authenticated using \(([^;]+)\);/g)];
    expect(policies.length).toBe(5);
    for (const [, table, using] of policies) expect(using, table).toContain("array['owner']");
  });
});
