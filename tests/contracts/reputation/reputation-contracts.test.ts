// P24 · Coerência entre o registro v1, as rotas da função `reputation` e as RPCs da migration; invariantes.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EventType, OPERATIONS, type OperationName, PublicReview, ReputationSummary } from "@contracts";
import { REPUTATION_OWNER_ROUTES, REPUTATION_PUBLIC, REPUTATION_USER_ROUTES } from "../../../supabase/functions/reputation/handler.ts";

const dir = new URL("../../../supabase/migrations/", import.meta.url);
const sql = readdirSync(dir).filter((f) => /^\d{14}_p24_.*\.sql$/.test(f)).map((f) => readFileSync(new URL(f, dir), "utf8")).join("\n");
function sqlParams(fn: string): string[] {
  const m = new RegExp(`create function public\\.${fn}\\(([\\s\\S]*?)\\)\\s*returns`, "m").exec(sql);
  if (!m) throw new Error(`função ${fn} não encontrada`);
  return (m[1] ?? "").split(",").map((p) => p.trim().split(/\s+/)[0] ?? "").filter(Boolean);
}
const defOf = (fn: string) => sql.slice(sql.indexOf(`create function public.${fn}(`)).split(/\nend \$\$;/)[0]!;
const ops = (Object.keys(OPERATIONS) as OperationName[]).filter((n) => OPERATIONS[n].module === "reputation");
const anything: unknown = new Proxy({}, { get: () => anything });

describe("reputation · registro ↔ função ↔ SQL", () => {
  it("toda operação do módulo tem rota", () => {
    expect([...Object.keys(REPUTATION_OWNER_ROUTES), ...Object.keys(REPUTATION_USER_ROUTES), ...Object.keys(REPUTATION_PUBLIC)].sort()).toEqual([...ops].sort());
  });
  it.each([...Object.entries(REPUTATION_OWNER_ROUTES), ...Object.entries(REPUTATION_USER_ROUTES)])("%s usa os schemas e o tipo do registro", (name, r) => {
    const op = OPERATIONS[name as OperationName];
    expect(r.input).toBe(op.input);
    expect(r.output).toBe(op.output);
    expect(r.command).toBe(op.kind === "command");
  });
  it.each(Object.entries(REPUTATION_OWNER_ROUTES))("%s (dono) passa exatamente os parâmetros da RPC", (_n, r) => {
    const names = ["p_tenant_id", ...Object.keys(r.args(anything as never) as object)];
    if (r.command) names.push("p_idem_key", "p_request_hash", "p_request_id");
    expect(names.sort()).toEqual([...sqlParams(r.rpc)].sort());
  });
  it.each(Object.entries(REPUTATION_USER_ROUTES))("%s (cliente) passa exatamente os parâmetros da RPC", (_n, r) => {
    expect(Object.keys(r.args(anything as never)).sort()).toEqual([...sqlParams(r.rpc)].sort());
  });
  it("moderação e identidade só pelo backend; anon só na lista pública", () => {
    expect(sql).toMatch(/revoke all on function public\.review_moderate\([^)]*\) from public, anon, authenticated;/);
    expect(sql).toMatch(/revoke all on function public\.identity_verify_set\([^)]*\) from public, anon, authenticated;/);
    for (const r of [...Object.values(REPUTATION_OWNER_ROUTES), ...Object.values(REPUTATION_USER_ROUTES)]) {
      expect(sql, r.rpc).toMatch(new RegExp(`revoke all on function public\\.${r.rpc}\\([^)]*\\) from public, anon;`));
      expect(defOf(r.rpc), r.rpc).toContain("security definer set search_path = ''");
    }
  });
});

describe("reputation · invariantes", () => {
  it("o autor nunca está nos contratos de leitura", () => {
    expect(Object.keys(PublicReview.shape).join(" ")).not.toMatch(/author|user|customer|phone|email/);
  });
  it("competência certificada é literal falso (P39) e média só com mínimo", () => {
    expect(ReputationSummary.shape.certified_competence.safeParse(true).success).toBe(false);
    expect(sql).toContain("'min_reviews_for_average', 3");
  });
  it("nada comprável: avaliações não tocam pagamento, plano ou benefício", () => {
    expect(sql).not.toMatch(/payment_|receivables|subscriptions|referral_rewards|agent_quotas/);
  });
  it("profissional não edita nota nem texto do cliente", () => {
    const reply = defOf("review_reply");
    expect(reply).toContain("set reply_body = btrim(p_body)");
    expect(reply).not.toMatch(/[\s,(]rating\s*=|[\s,(]body\s*=/);
  });
  it("evento novo no catálogo", () => {
    expect(EventType.options).toContain("review.published.v1");
  });
});
