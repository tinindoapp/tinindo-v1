// P28 · Coerência entre o registro v1, as rotas da função `resources` e as RPCs da migration.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { OPERATIONS, type OperationName, TeamBookingCreateInput, TeamResourceSaveInput } from "@contracts";
import { RESOURCES_ROUTES } from "../../../supabase/functions/resources/handler.ts";

const dir = new URL("../../../supabase/migrations/", import.meta.url);
const sql = readdirSync(dir).filter((f) => /^\d{14}_p28_.*\.sql$/.test(f)).map((f) => readFileSync(new URL(f, dir), "utf8")).join("\n");
function sqlParams(fn: string): string[] {
  const m = new RegExp(`create function public\\.${fn}\\(([\\s\\S]*?)\\)\\s*returns`, "m").exec(sql);
  if (!m) throw new Error(`função ${fn} não encontrada`);
  return (m[1] ?? "").split(",").map((p) => p.trim().split(/\s+/)[0] ?? "").filter(Boolean);
}
const defOf = (fn: string) => sql.slice(sql.indexOf(`create function public.${fn}(`)).split(/\nend \$\$;/)[0]!;
const ops = (Object.keys(OPERATIONS) as OperationName[]).filter((n) => OPERATIONS[n].module === "resources");

describe("resources · registro ↔ função ↔ SQL", () => {
  it("toda operação do módulo tem rota", () => {
    expect(ops.length).toBe(15);
    expect(Object.keys(RESOURCES_ROUTES).sort()).toEqual([...ops].sort());
  });
  it.each(ops)("%s usa os mesmos schemas e o mesmo tipo do registro", (name) => {
    const r = RESOURCES_ROUTES[name]!;
    expect(r.input).toBe(OPERATIONS[name].input);
    expect(r.output).toBe(OPERATIONS[name].output);
    expect(r.command).toBe(OPERATIONS[name].kind === "command");
  });
  it.each(Object.entries(RESOURCES_ROUTES))("%s passa exatamente os parâmetros da RPC", (_n, r) => {
    const anything: unknown = new Proxy({}, { get: () => anything });
    const names = ["p_tenant_id", ...Object.keys(r.args(anything as never) as object)];
    if (r.command) names.push("p_idem_key", "p_request_hash", "p_request_id");
    expect(names.sort()).toEqual([...sqlParams(r.rpc)].sort());
  });
  it("RPCs do dono: SECURITY DEFINER, dono autorizado primeiro, anon revogado; regras internas fora do alcance", () => {
    for (const r of Object.values(RESOURCES_ROUTES)) {
      expect(sql, r.rpc).toMatch(new RegExp(`revoke all on function public\\.${r.rpc}\\([^)]*\\) from public, anon;`));
      const def = defOf(r.rpc);
      expect(def, r.rpc).toContain("security definer set search_path = ''");
      expect(def, r.rpc).toMatch(/begin\n {2}perform app\.tm_owner\(p_tenant_id\);/);
    }
    expect(sql).toMatch(/revoke all on function app\.tm_owner[\s\S]*app\.tm_allocate\([^)]*\)[\s\S]*from public, anon, authenticated;/);
  });
  it("comandos usam o nome da operação no claim de idempotência", () => {
    for (const [name, r] of Object.entries(RESOURCES_ROUTES)) {
      if (!r.command) continue;
      expect(defOf(r.rpc), name).toContain(`app.idempotency_claim(p_tenant_id, v_uid, '${name}'`);
    }
  });
  it("tudo ou nada: exclusão por recurso, trava em ordem de id, agenda individual protegida nos dois sentidos", () => {
    expect(sql).toContain("constraint team_allocations_no_overlap exclude using gist (tenant_id with =, resource_id with =, occupied_range with &&) where (active)");
    expect(sql).toMatch(/r\.id = any \(v_ids\) order by r\.id for update/);
    expect(sql).toMatch(/create trigger bookings_team_guard before insert or update on public\.bookings/);
    expect(sql).toMatch(/create trigger availability_blocks_team_guard before insert or update on public\.availability_blocks/);
    expect(sql).toContain("create unique index team_commission_one_per_booking");
    expect(sql).toMatch(/create trigger team_commission_entries_append_only before update or delete/);
  });
  it("contrato: recurso repetido recusado; reserva sem cliente e sem recursos extras por padrão", () => {
    const id = "40000000-0000-4000-8000-0000000000a1";
    expect(TeamBookingCreateInput.safeParse({ service_id: id, professional_id: id, resource_ids: [id, id], starts_at: "2026-11-02T13:00:00Z" }).success).toBe(false);
    expect(TeamBookingCreateInput.parse({ service_id: id, professional_id: id, starts_at: "2026-11-02T13:00:00Z" })).toMatchObject({ customer_id: null, resource_ids: [] });
    expect(TeamResourceSaveInput.parse({ kind: "room", name: " Sala 1 " })).toMatchObject({ name: "Sala 1", commission_bps: null, agenda_linked: false, active: true });
  });
});
