// P30 · Coerência entre o registro v1, as rotas da função `materials` e as RPCs da migration.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { OPERATIONS, type OperationName, MaterialConsumeInput, MaterialPurchaseInput } from "@contracts";
import { MATERIALS_ROUTES } from "../../../supabase/functions/materials/handler.ts";

const dir = new URL("../../../supabase/migrations/", import.meta.url);
const sql = readdirSync(dir).filter((f) => /^\d{14}_p30_.*\.sql$/.test(f)).map((f) => readFileSync(new URL(f, dir), "utf8")).join("\n");
function sqlParams(fn: string): string[] {
  const m = new RegExp(`create function public\\.${fn}\\(([\\s\\S]*?)\\)\\s*returns`, "m").exec(sql);
  if (!m) throw new Error(`função ${fn} não encontrada`);
  return (m[1] ?? "").split(",").map((p) => p.trim().split(/\s+/)[0] ?? "").filter(Boolean);
}
const defOf = (fn: string) => sql.slice(sql.indexOf(`create function public.${fn}(`)).split(/\nend \$\$;/)[0]!;
const ops = (Object.keys(OPERATIONS) as OperationName[]).filter((n) => OPERATIONS[n].module === "materials");

describe("materials · registro ↔ função ↔ SQL", () => {
  it("toda operação do módulo tem rota", () => {
    expect(ops.length).toBe(12);
    expect(Object.keys(MATERIALS_ROUTES).sort()).toEqual([...ops].sort());
  });
  it.each(ops)("%s usa os mesmos schemas e o mesmo tipo do registro", (name) => {
    const r = MATERIALS_ROUTES[name]!;
    expect(r.input).toBe(OPERATIONS[name].input);
    expect(r.output).toBe(OPERATIONS[name].output);
    expect(r.command).toBe(OPERATIONS[name].kind === "command");
  });
  it.each(Object.entries(MATERIALS_ROUTES))("%s passa exatamente os parâmetros da RPC", (_n, r) => {
    const anything: unknown = new Proxy({}, { get: () => anything });
    const names = ["p_tenant_id", ...Object.keys(r.args(anything as never) as object)];
    if (r.command) names.push("p_idem_key", "p_request_hash", "p_request_id");
    expect(names.sort()).toEqual([...sqlParams(r.rpc)].sort());
  });
  it("RPCs do dono: SECURITY DEFINER, dono autorizado primeiro, anon revogado; regras internas fora do alcance", () => {
    for (const r of Object.values(MATERIALS_ROUTES)) {
      expect(sql, r.rpc).toMatch(new RegExp(`revoke all on function public\\.${r.rpc}\\([^)]*\\) from public, anon;`));
      const def = defOf(r.rpc);
      expect(def, r.rpc).toContain("security definer set search_path = ''");
      expect(def, r.rpc).toMatch(/begin\n {2}perform app\.mt_owner\(p_tenant_id\);/);
    }
    expect(sql).toMatch(/revoke all on function app\.mt_owner[\s\S]*app\.mt_move\([^)]*\)[\s\S]*from public, anon, authenticated;/);
  });
  it("comandos usam o nome da operação no claim de idempotência", () => {
    for (const [name, r] of Object.entries(MATERIALS_ROUTES)) {
      if (!r.command) continue;
      expect(defOf(r.rpc), name).toContain(`app.idempotency_claim(p_tenant_id, v_uid, '${name}'`);
    }
  });
  it("consumo e estorno não duplicam estoque: razão append-only, um consumo ativo, estorno único, sem saldo negativo", () => {
    expect(sql).toContain("create unique index material_consumptions_one_active on public.material_consumptions (booking_id) where status = 'active'");
    expect(sql).toContain("create unique index material_movements_one_reversal on public.material_movements (reversal_of) where reversal_of is not null");
    expect(sql).toMatch(/create trigger material_movements_append_only before update or delete on public\.material_movements/);
    expect(sql).toContain("on_hand numeric(14, 3) not null default 0 check (on_hand >= 0)");
    expect(sql).toMatch(/i\.id = any \(p_ids\) order by i\.id for update/);
  });
  it("contrato: compra sem item repetido e com despesa por padrão; consumo pela ficha quando não há linhas", () => {
    const id = "40000000-0000-4000-8000-0000000000a1";
    const line = { item_id: id, quantity: 1.25, total_cents: 100 };
    expect(MaterialPurchaseInput.safeParse({ purchased_at: "2026-10-27T12:00:00Z", lines: [line, line] }).success).toBe(false);
    expect(MaterialPurchaseInput.parse({ purchased_at: "2026-10-27T12:00:00Z", lines: [line] })).toMatchObject({ record_expense: true, supplier: null });
    expect(MaterialConsumeInput.parse({ booking_id: id })).toEqual({ booking_id: id, lines: null });
    expect(MaterialConsumeInput.safeParse({ booking_id: id, lines: [{ item_id: id, quantity: 1.0005 }] }).success).toBe(false);
  });
});
