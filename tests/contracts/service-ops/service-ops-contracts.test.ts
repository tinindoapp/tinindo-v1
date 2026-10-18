// P15 · Coerência entre o registro v1, as rotas da função `service-ops` e as RPCs da migration.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AccessScope, OPERATIONS, type OperationName, ServiceOrderStatus } from "@contracts";
import { SERVICE_OPS_ROUTES } from "../../../supabase/functions/service-ops/handler.ts";

const dir = new URL("../../../supabase/migrations/", import.meta.url);
const sql = readdirSync(dir)
  .filter((f) => /^\d{14}_p15_.*\.sql$/.test(f))
  .map((f) => readFileSync(new URL(f, dir), "utf8"))
  .join("\n");

function sqlParams(fn: string): string[] {
  const m = new RegExp(`create function public\\.${fn}\\(([\\s\\S]*?)\\)\\s*returns`, "m").exec(sql);
  if (!m) throw new Error(`função ${fn} não encontrada`);
  return (m[1] ?? "").split(",").map((p) => p.trim().split(/\s+/)[0] ?? "").filter(Boolean);
}
const defOf = (fn: string) => sql.slice(sql.indexOf(`create function public.${fn}(`)).split(/\nend \$\$;/)[0]!;
const anything: unknown = new Proxy({}, { get: () => anything });
const ops = (Object.keys(OPERATIONS) as OperationName[]).filter((n) => OPERATIONS[n].module === "service-ops");

describe("service-ops · registro ↔ função", () => {
  it("toda operação do módulo no registro tem rota, e vice-versa", () => {
    expect(Object.keys(SERVICE_OPS_ROUTES).sort()).toEqual([...ops].sort());
  });
  it.each(ops)("%s usa os mesmos schemas e o mesmo tipo do registro", (name) => {
    const r = SERVICE_OPS_ROUTES[name]!;
    expect(r.input).toBe(OPERATIONS[name].input);
    expect(r.output).toBe(OPERATIONS[name].output);
    expect(r.command).toBe(OPERATIONS[name].kind === "command");
  });
});

describe("service-ops · função ↔ SQL", () => {
  it.each(Object.entries(SERVICE_OPS_ROUTES))("%s passa exatamente os parâmetros da RPC", (_n, r) => {
    const built = r.args(anything as never);
    const names = [...(r.tenant === false ? [] : ["p_tenant_id"]), ...Object.keys(built as object)];
    if (r.command) names.push("p_idem_key", "p_request_hash", "p_request_id");
    expect(names.sort()).toEqual([...sqlParams(r.rpc)].sort());
  });

  it("toda RPC revoga anon, é SECURITY DEFINER e autoriza (dono ou operador) antes de tudo", () => {
    for (const [name, r] of Object.entries(SERVICE_OPS_ROUTES)) {
      expect(sql, r.rpc).toMatch(new RegExp(`revoke all on function public\\.${r.rpc}\\([^)]*\\) from public, anon;`));
      const def = defOf(r.rpc);
      expect(def, r.rpc).toContain("security definer set search_path = ''");
      const gate = name.startsWith("ops.") ? /begin\n {2}v_op := app\.svc_operator\(\);/ : /begin\n {2}perform app\.svc_owner\(p_tenant_id\);/;
      expect(def, r.rpc).toMatch(gate);
    }
  });

  it("comandos usam o nome da operação no claim de idempotência (ator = dono ou operador)", () => {
    for (const [name, r] of Object.entries(SERVICE_OPS_ROUTES)) {
      if (!r.command) continue;
      const actor = name.startsWith("ops.") ? "v_op.user_id" : "v_uid";
      expect(defOf(r.rpc), name).toContain(`app.idempotency_claim(p_tenant_id, ${actor}, '${name}'`);
      expect(defOf(r.rpc), name).toContain(`app.idempotency_complete(p_tenant_id, ${actor}, '${name}'`);
    }
  });

  it("estados e escopos do banco = contrato", () => {
    for (const s of ServiceOrderStatus.options) expect(sql).toContain(`'${s}'`);
    expect(sql).toContain("scopes <@ array['catalog', 'agenda', 'customers']");
    expect([...AccessScope.options].sort()).toEqual(["agenda", "catalog", "customers"]);
  });

  it("leitura delegada exige concessão ativa e audita; operador nunca é criado por RPC", () => {
    const snap = defOf("service_ops_snapshot");
    expect(snap).toContain("app.svc_active_grant(v_row.id, v_op.user_id)");
    expect(snap).toContain("'access.read'");
    expect(snap).not.toMatch(/c\.phone|c\.email|c\.notes/);
    expect(sql).not.toMatch(/insert into public\.platform_operators/);
  });

  it("minutos, entregas, versões publicadas e histórico são append-only", () => {
    for (const t of ["offering_versions", "work_logs", "deliverables", "deliverable_reviews", "service_order_events"]) {
      expect(sql).toMatch(new RegExp(`create trigger ${t}_append_only before update or delete on public\\.${t}`));
    }
  });
});
