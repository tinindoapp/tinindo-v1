// P32 bloco 1 · rotas de uso (função `analytics`, fora do registro v1) ↔ RPCs da migration p32_uso.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { OPERATIONS } from "@contracts";
import { USAGE_ROUTES } from "../../../supabase/functions/analytics/usage.ts";

const dir = new URL("../../../supabase/migrations/", import.meta.url);
const sql = readdirSync(dir).filter((f) => /^\d{14}_p32_.*\.sql$/.test(f)).sort().map((f) => readFileSync(new URL(f, dir), "utf8")).join("\n");
function sqlParams(fn: string): string[] {
  const m = new RegExp(`create (?:or replace )?function public\\.${fn}\\(([\\s\\S]*?)\\)\\s*returns`, "m").exec(sql);
  if (!m) throw new Error(`função ${fn} não encontrada`);
  return (m[1] ?? "").split(",").map((p) => p.trim().split(/\s+/)[0] ?? "").filter(Boolean);
}
const anything: unknown = new Proxy({}, { get: () => anything });

describe("uso · rotas ↔ SQL", () => {
  it("as rotas de uso ainda não estão no registro v1 (recado ao integrador)", () => {
    for (const name of Object.keys(USAGE_ROUTES)) expect(Object.keys(OPERATIONS)).not.toContain(name);
  });
  it.each(Object.entries(USAGE_ROUTES))("%s passa exatamente os parâmetros da RPC", (_n, r) => {
    const names = ["p_tenant_id", ...Object.keys(r.args(anything as never) as object)];
    if (r.command) names.push("p_idem_key", "p_request_hash", "p_request_id");
    expect(names.sort()).toEqual([...sqlParams(r.rpc)].sort());
  });
  it("RPCs revogam anon e são SECURITY DEFINER com search_path vazio", () => {
    for (const r of Object.values(USAGE_ROUTES)) {
      expect(sql, r.rpc).toMatch(new RegExp(`revoke all on function public\\.${r.rpc}\\([^)]*\\) from public, anon;`));
      const def = sql.slice(sql.indexOf(`function public.${r.rpc}(`)).split(/\nend \$\$;/)[0]!;
      expect(def, r.rpc).toContain("security definer set search_path = ''");
      expect(def, r.rpc).toMatch(/app\.is_member\(p_tenant_id/);
    }
  });
  it("o comando de desligar usa o próprio nome no claim de idempotência", () => {
    expect(sql).toContain("app.idempotency_claim(p_tenant_id, v_uid, 'usage.settings_set'");
  });
});
