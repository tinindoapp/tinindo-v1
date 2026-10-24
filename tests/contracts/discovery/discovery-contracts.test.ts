// P23 · Coerência entre o registro v1, as rotas da função `discovery` e as RPCs da migration; invariantes.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DirectoryCard, OPERATIONS, type OperationName } from "@contracts";
import { DISCOVERY_PUBLIC, DISCOVERY_ROUTES } from "../../../supabase/functions/discovery/handler.ts";

const dir = new URL("../../../supabase/migrations/", import.meta.url);
const sql = readdirSync(dir).filter((f) => /^\d{14}_p23_.*\.sql$/.test(f)).map((f) => readFileSync(new URL(f, dir), "utf8")).join("\n");
function sqlParams(fn: string): string[] {
  const m = new RegExp(`create function public\\.${fn}\\(([\\s\\S]*?)\\)\\s*returns`, "m").exec(sql);
  if (!m) throw new Error(`função ${fn} não encontrada`);
  return (m[1] ?? "").split(",").map((p) => p.trim().split(/\s+/)[0] ?? "").filter(Boolean);
}
const defOf = (fn: string) => sql.slice(sql.indexOf(`create function public.${fn}(`)).split(/\nend \$\$;/)[0]!;
const ops = (Object.keys(OPERATIONS) as OperationName[]).filter((n) => OPERATIONS[n].module === "discovery");

describe("discovery · registro ↔ função ↔ SQL", () => {
  it("toda operação do módulo tem rota (dono ou pública)", () => {
    expect([...Object.keys(DISCOVERY_ROUTES), ...Object.keys(DISCOVERY_PUBLIC)].sort()).toEqual([...ops].sort());
  });
  it.each(Object.keys(DISCOVERY_ROUTES))("%s usa os mesmos schemas do registro", (name) => {
    const r = DISCOVERY_ROUTES[name]!;
    expect(r.input).toBe(OPERATIONS[name as OperationName].input);
    expect(r.output).toBe(OPERATIONS[name as OperationName].output);
    expect(r.command).toBe(OPERATIONS[name as OperationName].kind === "command");
  });
  it.each(Object.entries(DISCOVERY_PUBLIC))("%s (público) usa os schemas do registro", (name, r) => {
    expect(r.input).toBe(OPERATIONS[name as OperationName].input);
    expect(r.output).toBe(OPERATIONS[name as OperationName].output);
  });
  it.each(Object.entries(DISCOVERY_ROUTES))("%s passa exatamente os parâmetros da RPC", (_n, r) => {
    const anything: unknown = new Proxy({}, { get: () => anything });
    const names = ["p_tenant_id", ...Object.keys(r.args(anything as never) as object)];
    if (r.command) names.push("p_idem_key", "p_request_hash", "p_request_id");
    expect(names.sort()).toEqual([...sqlParams(r.rpc)].sort());
  });
  it("busca pública com os parâmetros esperados; dono com SECURITY DEFINER; moderação só backend", () => {
    expect(sqlParams("discovery_search")).toEqual(["p_uf", "p_city_slug", "p_category", "p_area", "p_weekday", "p_page"]);
    for (const r of Object.values(DISCOVERY_ROUTES)) {
      expect(sql, r.rpc).toMatch(new RegExp(`revoke all on function public\\.${r.rpc}\\([^)]*\\) from public, anon;`));
      expect(defOf(r.rpc), r.rpc).toContain("security definer set search_path = ''");
    }
    expect(sql).toMatch(/revoke all on function public\.discovery_moderate\([^)]*\) from public, anon, authenticated;/);
  });
});

describe("discovery · invariantes", () => {
  it("cartão só com campos autorizados: sem contato, preço, nota ou posição", () => {
    expect(Object.keys(DirectoryCard.shape).join(" ")).not.toMatch(/phone|email|price|rating|rank|score|position/i);
    const cardFn = sql.slice(sql.indexOf("create function app.dsc_card"), sql.indexOf("create function app.dsc_sort_name"));
    expect(cardFn).not.toMatch(/public\.customers|bookings|provider_services|phone|email/);
  });
  it("ordem documentada e sem destaque pago", () => {
    expect(sql).toContain("'order', 'ordem alfabética do nome exibido'");
    expect(sql).toContain("'destaque pago'");
    expect(defOf("discovery_search")).toContain("order by h.sort_name, h.slug");
  });
});
