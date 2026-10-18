// P06 · Coerência entre o registro v1, as rotas da função `waitlist` e as RPCs da migration.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { OPERATIONS, type OperationName } from "@contracts";
import { WAITLIST_PUBLIC_ROUTES, WAITLIST_ROUTES } from "../../../supabase/functions/waitlist/handler.ts";

const dir = new URL("../../../supabase/migrations/", import.meta.url);
const sql = readdirSync(dir)
  .filter((f) => /^\d{14}_p06_.*\.sql$/.test(f))
  .map((f) => readFileSync(new URL(f, dir), "utf8"))
  .join("\n");

function sqlParams(fn: string): string[] {
  const m = new RegExp(`create function public\\.${fn}\\(([\\s\\S]*?)\\)\\s*returns`, "m").exec(sql);
  if (!m?.[1]) throw new Error(`função ${fn} não encontrada`);
  return m[1].split(",").map((p) => p.trim().split(/\s+/)[0] ?? "").filter(Boolean);
}

const waitlistOps = (Object.keys(OPERATIONS) as OperationName[]).filter((n) => OPERATIONS[n].module === "waitlist");

describe("waitlist · registro ↔ função", () => {
  it("toda operação do módulo no registro tem rota, e vice-versa", () => {
    expect([...Object.keys(WAITLIST_ROUTES), ...Object.keys(WAITLIST_PUBLIC_ROUTES)].sort()).toEqual([...waitlistOps].sort());
  });

  it.each(waitlistOps.filter((n) => n in WAITLIST_ROUTES))("%s usa os mesmos schemas e o mesmo tipo do registro", (name) => {
    const route = WAITLIST_ROUTES[name]!;
    expect(route.input).toBe(OPERATIONS[name].input);
    expect(route.output).toBe(OPERATIONS[name].output);
    expect(route.command).toBe(OPERATIONS[name].kind === "command");
  });
});

describe("waitlist · função ↔ SQL", () => {
  it.each(Object.entries(WAITLIST_ROUTES))("%s passa exatamente os parâmetros da RPC", (_name, route) => {
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
    for (const route of Object.values(WAITLIST_ROUTES)) {
      expect(sql, route.rpc).toMatch(new RegExp(`revoke all on function public\\.${route.rpc}\\([^)]*\\) from public, anon;`));
      const def = sql.slice(sql.indexOf(`create function public.${route.rpc}(`)).split(/\nend \$\$;/)[0]!;
      expect(def, route.rpc).toContain("security definer set search_path = ''");
      expect(def, route.rpc).toMatch(/app\.is_member\(p_tenant_id, array\['owner'\]\)/);
    }
  });

  it("comandos usam o nome da operação no claim de idempotência", () => {
    for (const [name, route] of Object.entries(WAITLIST_ROUTES)) {
      if (!route.command) continue;
      const def = sql.slice(sql.indexOf(`create function public.${route.rpc}(`)).split(/\nend \$\$;/)[0]!;
      expect(def, name).toContain(`app.idempotency_claim(p_tenant_id, v_uid, '${name}'`);
      expect(def, name).toContain(`app.idempotency_complete(p_tenant_id, v_uid, '${name}'`);
    }
  });

  it("rotas do link: anônimas, só com o token, e o banco guarda só o hash", () => {
    for (const [name, r] of Object.entries(WAITLIST_PUBLIC_ROUTES)) {
      expect(sqlParams(r.rpc), name).toEqual(["p_token"]);
      expect(sql, name).toMatch(new RegExp(`grant execute on function public\\.${r.rpc}\\(text\\) to anon, authenticated;`));
      expect(r.output, name).toBe(OPERATIONS[name as OperationName].output);
    }
    expect(sql).toContain("token_hash text not null check (token_hash ~ '^[0-9a-f]{64}$')");
    expect(sql).toContain("app.token_sha256(v_token)");
  });

  it("compartilhamento manual nunca vira entregue (CHECK)", () => {
    expect(sql).toContain("delivery_channel <> 'manual_share' or delivery_state in ('prepared', 'share_opened')");
  });

  it("worker só para o backend", () => {
    expect(sql).toContain("revoke all on function public.jobs_run(integer) from public, anon, authenticated;");
    expect(sql).toContain("for update skip locked");
  });
});
