// P31 · Coerência entre o registro v1, as rotas da função `finance-advanced` e as RPCs da migration.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { OPERATIONS, type OperationName, AccPayableSaveInput, AccStatementOutput } from "@contracts";
import { FINANCE_ADVANCED_ROUTES } from "../../../supabase/functions/finance-advanced/handler.ts";

const dir = new URL("../../../supabase/migrations/", import.meta.url);
const sql = readdirSync(dir).filter((f) => /^\d{14}_p31_.*\.sql$/.test(f)).map((f) => readFileSync(new URL(f, dir), "utf8")).join("\n");
function sqlParams(fn: string): string[] {
  const m = new RegExp(`create function public\\.${fn}\\(([\\s\\S]*?)\\)\\s*returns`, "m").exec(sql);
  if (!m) throw new Error(`função ${fn} não encontrada`);
  return (m[1] ?? "").split(",").map((p) => p.trim().split(/\s+/)[0] ?? "").filter(Boolean);
}
const defOf = (fn: string) => sql.slice(sql.indexOf(`create function public.${fn}(`)).split(/\nend \$\$;/)[0]!;
const ops = (Object.keys(OPERATIONS) as OperationName[]).filter((n) => OPERATIONS[n].module === "finance-advanced");

describe("finance-advanced · registro ↔ função ↔ SQL", () => {
  it("toda operação do módulo tem rota", () => {
    expect(ops.length).toBe(13);
    expect(Object.keys(FINANCE_ADVANCED_ROUTES).sort()).toEqual([...ops].sort());
  });
  it.each(ops)("%s usa os mesmos schemas e o mesmo tipo do registro", (name) => {
    const r = FINANCE_ADVANCED_ROUTES[name]!;
    expect(r.input).toBe(OPERATIONS[name].input);
    expect(r.output).toBe(OPERATIONS[name].output);
    expect(r.command).toBe(OPERATIONS[name].kind === "command");
  });
  it.each(Object.entries(FINANCE_ADVANCED_ROUTES))("%s passa exatamente os parâmetros da RPC", (_n, r) => {
    const anything: unknown = new Proxy({}, { get: () => anything });
    const names = ["p_tenant_id", ...Object.keys(r.args(anything as never) as object)];
    if (r.command) names.push("p_idem_key", "p_request_hash", "p_request_id");
    expect(names.sort()).toEqual([...sqlParams(r.rpc)].sort());
  });
  it("RPCs do dono: SECURITY DEFINER, dono autorizado primeiro, anon revogado; regras internas fora do alcance", () => {
    for (const r of Object.values(FINANCE_ADVANCED_ROUTES)) {
      expect(sql, r.rpc).toMatch(new RegExp(`revoke all on function public\\.${r.rpc}\\([^)]*\\) from public, anon;`));
      const def = defOf(r.rpc);
      expect(def, r.rpc).toContain("security definer set search_path = ''");
      expect(def, r.rpc).toMatch(/begin\n {2}perform app\.fa_owner\(p_tenant_id\);/);
    }
    expect(sql).toMatch(/revoke all on function app\.fa_owner[\s\S]*app\.fa_materialize\([^)]*\)[\s\S]*from public, anon, authenticated;/);
  });
  it("comandos usam o nome da operação no claim de idempotência", () => {
    for (const [name, r] of Object.entries(FINANCE_ADVANCED_ROUTES)) {
      if (!r.command) continue;
      expect(defOf(r.rpc), name).toContain(`app.idempotency_claim(p_tenant_id, v_uid, '${name}'`);
    }
  });
  it("pagar duas vezes não baixa duas vezes: um pagamento vivo por conta, estorno único, pagamento não se edita", () => {
    expect(sql).toContain("create unique index fin_payable_payments_one_live on public.fin_payable_payments (payable_id) where reversal_expense_id is null");
    expect(sql).toMatch(/create trigger fin_payable_payments_guard before update or delete on public\.fin_payable_payments/);
    expect(sql).toContain("unique (reversal_expense_id)");
    expect(defOf("accounts_payable_pay")).toMatch(/for update;/);
    // Despesa no Caixa pelo caminho do P07 (expense_entries), sem alterar tabelas de outros pacotes.
    expect(sql).not.toMatch(/alter table public\.(expense_entries|payment_entries|receivables|payment_charges)/);
    expect(sql).toMatch(/create trigger fin_reconciliations_append_only before update or delete/);
  });
  it("demonstrativo é de caixa e diz que não é DRE; nova conta é única por padrão", () => {
    expect(AccStatementOutput.shape.basis.value).toBe("cash");
    expect(sql).toContain("Não é DRE");
    expect(sql).not.toMatch(/'DRE'|"DRE"/);
    expect(AccPayableSaveInput.parse({ description: " Aluguel ", amount_cents: 100, due_on: "2026-11-10" })).toMatchObject({ description: "Aluguel", monthly: false, base_category: "other", payable_id: null });
  });
});
