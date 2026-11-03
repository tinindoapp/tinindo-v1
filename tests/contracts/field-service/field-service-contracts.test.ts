// P29 · Coerência entre o registro v1, as rotas da função `field-service` e as RPCs da migration.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { OPERATIONS, type OperationName, FieldVisitAttachInput, FieldZoneSaveInput } from "@contracts";
import { FIELD_SERVICE_ROUTES } from "../../../supabase/functions/field-service/handler.ts";

const dir = new URL("../../../supabase/migrations/", import.meta.url);
const sql = readdirSync(dir).filter((f) => /^\d{14}_p29_.*\.sql$/.test(f)).map((f) => readFileSync(new URL(f, dir), "utf8")).join("\n");
function sqlParams(fn: string): string[] {
  const m = new RegExp(`create function public\\.${fn}\\(([\\s\\S]*?)\\)\\s*returns`, "m").exec(sql);
  if (!m) throw new Error(`função ${fn} não encontrada`);
  return (m[1] ?? "").split(",").map((p) => p.trim().split(/\s+/)[0] ?? "").filter(Boolean);
}
const defOf = (fn: string) => sql.slice(sql.indexOf(`create function public.${fn}(`)).split(/\nend \$\$;/)[0]!;
const ops = (Object.keys(OPERATIONS) as OperationName[]).filter((n) => OPERATIONS[n].module === "field-service");

describe("field-service · registro ↔ função ↔ SQL", () => {
  it("toda operação do módulo tem rota", () => {
    expect(ops.length).toBe(9);
    expect(Object.keys(FIELD_SERVICE_ROUTES).sort()).toEqual([...ops].sort());
  });
  it.each(ops)("%s usa os mesmos schemas e o mesmo tipo do registro", (name) => {
    const r = FIELD_SERVICE_ROUTES[name]!;
    expect(r.input).toBe(OPERATIONS[name].input);
    expect(r.output).toBe(OPERATIONS[name].output);
    expect(r.command).toBe(OPERATIONS[name].kind === "command");
  });
  it.each(Object.entries(FIELD_SERVICE_ROUTES))("%s passa exatamente os parâmetros da RPC", (_n, r) => {
    const anything: unknown = new Proxy({}, { get: () => anything });
    const names = ["p_tenant_id", ...Object.keys(r.args(anything as never) as object)];
    if (r.command) names.push("p_idem_key", "p_request_hash", "p_request_id");
    expect(names.sort()).toEqual([...sqlParams(r.rpc)].sort());
  });
  it("RPCs do dono: SECURITY DEFINER, dono autorizado primeiro, anon revogado; regras internas fora do alcance", () => {
    for (const r of Object.values(FIELD_SERVICE_ROUTES)) {
      expect(sql, r.rpc).toMatch(new RegExp(`revoke all on function public\\.${r.rpc}\\([^)]*\\) from public, anon;`));
      const def = defOf(r.rpc);
      expect(def, r.rpc).toContain("security definer set search_path = ''");
      expect(def, r.rpc).toMatch(/begin\n {2}perform app\.fs_owner\(p_tenant_id\);/);
    }
    expect(sql).toMatch(/revoke all on function app\.fs_ceps_ok[\s\S]*app\.fs_owner\(uuid\)[\s\S]*app\.fs_rebuild_day\(uuid, date\)[\s\S]*from public, anon, authenticated;/);
  });
  it("comandos usam o nome da operação no claim de idempotência", () => {
    for (const [name, r] of Object.entries(FIELD_SERVICE_ROUTES)) {
      if (!r.command) continue;
      expect(defOf(r.rpc), name).toContain(`app.idempotency_claim(p_tenant_id, v_uid, '${name}'`);
    }
  });
  it("localização com finalidade e precisão limitadas: só zona e CEP de 5 dígitos, nada de endereço ou coordenada", () => {
    const tables = sql.match(/create table public\.field_[\s\S]*?\n\);/g) ?? [];
    expect(tables.length).toBe(4);
    for (const t of tables) expect(t.replace(/--.*$/gm, "")).not.toMatch(/\b(lat|lng|lon|latitude|longitude|geo\w*|address|endereco|street|rua|location|coord\w*)\b/i);
    expect(sql).toContain("cep5 text check (cep5 ~ '^[0-9]{5}$')");
  });
  it("deslocamento vira bloqueio da agenda do P03, sob o mesmo lock; motor da agenda não muda", () => {
    expect(sql).toMatch(/insert into public\.availability_blocks/);
    expect(defOf("field_visit_attach")).toMatch(/perform app\.sched_lock_resource\(p_tenant_id, app\.fs_agenda\(p_tenant_id\)\)/);
    expect(sql).not.toMatch(/create or replace function (public|app)\.sched/);
    expect(sql).toMatch(/create trigger bookings_field_visit after update of occupied_range, blocks_capacity on public\.bookings/);
  });
  it("contrato: CEP de 5 dígitos; visita sem CEP por padrão", () => {
    const id = "40000000-0000-4000-8000-0000000000a1";
    expect(FieldVisitAttachInput.parse({ booking_id: id, zone_id: id })).toEqual({ booking_id: id, zone_id: id, cep5: null });
    expect(FieldZoneSaveInput.safeParse({ name: "x", cep_prefixes: ["01310-100"], distance_km: 1, travel_from_base_min: 1 }).success).toBe(false);
  });
});
