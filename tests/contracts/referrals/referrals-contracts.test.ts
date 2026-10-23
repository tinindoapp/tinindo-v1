// P21 · Coerência entre o registro v1, as rotas da função `referrals` e as RPCs da migration; invariantes do programa.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EventType, OPERATIONS, type OperationName } from "@contracts";
import { REFERRALS_ROUTES } from "../../../supabase/functions/referrals/handler.ts";

const dir = new URL("../../../supabase/migrations/", import.meta.url);
const sql = readdirSync(dir).filter((f) => /^\d{14}_p21_.*\.sql$/.test(f)).map((f) => readFileSync(new URL(f, dir), "utf8")).join("\n");
function sqlParams(fn: string): string[] {
  const m = new RegExp(`create function public\\.${fn}\\(([\\s\\S]*?)\\)\\s*returns`, "m").exec(sql);
  if (!m) throw new Error(`função ${fn} não encontrada`);
  return (m[1] ?? "").split(",").map((p) => p.trim().split(/\s+/)[0] ?? "").filter(Boolean);
}
const defOf = (fn: string) => sql.slice(sql.indexOf(`create function public.${fn}(`)).split(/\nend \$\$;/)[0]!;
const ops = (Object.keys(OPERATIONS) as OperationName[]).filter((n) => OPERATIONS[n].module === "referrals");

describe("referrals · registro ↔ função ↔ SQL", () => {
  it("toda operação do módulo tem rota e é leitura", () => {
    expect(Object.keys(REFERRALS_ROUTES).sort()).toEqual([...ops].sort());
    for (const n of ops) expect(OPERATIONS[n].kind).toBe("query");
  });
  it.each(ops)("%s usa os mesmos schemas do registro", (name) => {
    const r = REFERRALS_ROUTES[name]!;
    expect(r.input).toBe(OPERATIONS[name].input);
    expect(r.output).toBe(OPERATIONS[name].output);
    expect(r.command).toBe(false);
  });
  it.each(Object.entries(REFERRALS_ROUTES))("%s passa exatamente os parâmetros da RPC", (_n, r) => {
    expect(["p_tenant_id", ...Object.keys(r.args({} as never) as object)].sort()).toEqual([...sqlParams(r.rpc)].sort());
  });
  it("RPCs do dono: SECURITY DEFINER, dono autorizado, anon revogado; avaliação e benefício só do backend", () => {
    for (const r of Object.values(REFERRALS_ROUTES)) {
      expect(sql, r.rpc).toMatch(new RegExp(`revoke all on function public\\.${r.rpc}\\([^)]*\\) from public, anon;`));
      const def = defOf(r.rpc);
      expect(def, r.rpc).toContain("security definer set search_path = ''");
      expect(def, r.rpc).toMatch(/begin\n {2}perform app\.ref_owner\(p_tenant_id\);/);
    }
    expect(sql).toMatch(/revoke all on function[^;]*app\.ref_tick\(integer\) from public, anon, authenticated;/);
  });
  it("benefício só com uso medido, nunca avaliação: evento registrado; worker avalia; um por negócio; append-only; sem nota", () => {
    expect(EventType.options).toContain("referral.rewarded.v1");
    expect(sql).toContain("'referral.rewarded.v1'");
    expect(sql).toMatch(/create or replace function public\.jobs_run[\s\S]*app\.ref_tick\(100\)/);
    expect(sql).toMatch(/create unique index referral_activations_one_per_invitee[\s\S]*where status in \('eligible', 'rewarded'\)/);
    expect(sql).toContain("referral_id uuid not null unique references public.referrals (id)");
    expect(sql).toMatch(/create trigger referral_rewards_append_only before update or delete on public\.referral_rewards/);
    expect(sql).toContain("check (kind in ('agent_questions'))");
    expect(sql).toContain("check (block_reason in ('same_tenant', 'duplicate', 'window_expired'))");
    expect(sql).not.toMatch(/\b(rating|score|ranking)\b/i);
  });
});
