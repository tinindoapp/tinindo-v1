// P32 · rotas da função `pilot` (equipe Tinindo, fora do registro v1) ↔ RPCs das migrations p32.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PILOT_ROUTES } from "../../../supabase/functions/pilot/handler.ts";

const dir = new URL("../../../supabase/migrations/", import.meta.url);
const sql = readdirSync(dir).filter((f) => /^\d{14}_p32_.*\.sql$/.test(f)).sort().map((f) => readFileSync(new URL(f, dir), "utf8")).join("\n");
const anything: unknown = new Proxy({}, { get: () => anything });
function sqlParams(fn: string): string[] {
  const m = new RegExp(`create (?:or replace )?function public\\.${fn}\\(([\\s\\S]*?)\\)\\s*returns`, "m").exec(sql);
  if (!m) throw new Error(`função ${fn} não encontrada`);
  return (m[1] ?? "").split(",").map((p) => p.trim().split(/\s+/)[0] ?? "").filter(Boolean);
}

describe("pilot · rotas ↔ SQL", () => {
  it.each(Object.entries(PILOT_ROUTES))("%s: sem negócio, leitura, parâmetros exatos da RPC", (_n, r) => {
    expect(r.tenant).toBe(false);
    expect(r.command).toBe(false);
    expect(Object.keys(r.args(anything as never) as object).sort()).toEqual([...sqlParams(r.rpc)].sort());
  });
  it("toda RPC do piloto exige operador ativo, revoga anon e é SECURITY DEFINER", () => {
    for (const r of Object.values(PILOT_ROUTES)) {
      const def = sql.slice(sql.indexOf(`function public.${r.rpc}(`)).split(/\nend \$\$;/)[0]!;
      expect(def, r.rpc).toContain("security definer set search_path = ''");
      expect(def, r.rpc).toContain("perform app.svc_operator()");
      expect(sql, r.rpc).toMatch(new RegExp(`revoke all on function public\\.${r.rpc}\\([^)]*\\) from public, anon;`));
    }
  });
});
