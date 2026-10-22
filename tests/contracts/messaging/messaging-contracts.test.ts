// P12 · Coerência entre o registro v1, as rotas da função `messaging` e as RPCs da migration.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ChannelMessageStatus, EventType, OPERATIONS, type OperationName } from "@contracts";
import { MESSAGING_ROUTES } from "../../../supabase/functions/messaging/handler.ts";

const dir = new URL("../../../supabase/migrations/", import.meta.url);
const sql = readdirSync(dir).filter((f) => /^\d{14}_p12_.*\.sql$/.test(f)).map((f) => readFileSync(new URL(f, dir), "utf8")).join("\n");
function sqlParams(fn: string): string[] {
  const m = new RegExp(`create function public\\.${fn}\\(([\\s\\S]*?)\\)\\s*returns`, "m").exec(sql);
  if (!m) throw new Error(`função ${fn} não encontrada`);
  return (m[1] ?? "").split(",").map((p) => p.trim().split(/\s+/)[0] ?? "").filter(Boolean);
}
const defOf = (fn: string) => sql.slice(sql.indexOf(`create function public.${fn}(`)).split(/\nend \$\$;/)[0]!;
const ops = (Object.keys(OPERATIONS) as OperationName[]).filter((n) => OPERATIONS[n].module === "messaging");

describe("messaging · registro ↔ função ↔ SQL", () => {
  it("toda operação do módulo tem rota (sim.inbound é rota própria, pelo webhook)", () => {
    expect([...Object.keys(MESSAGING_ROUTES), "sim.inbound"].sort()).toEqual([...ops].sort());
  });
  it.each(ops.filter((n) => n !== "sim.inbound"))("%s usa os mesmos schemas e o mesmo tipo do registro", (name) => {
    const r = MESSAGING_ROUTES[name]!;
    expect(r.input).toBe(OPERATIONS[name].input);
    expect(r.output).toBe(OPERATIONS[name].output);
    expect(r.command).toBe(OPERATIONS[name].kind === "command");
  });
  it.each(Object.entries(MESSAGING_ROUTES))("%s passa exatamente os parâmetros da RPC", (_n, r) => {
    const anything: unknown = new Proxy({}, { get: (_t, k) => (k === "kind" ? "template" : anything) });
    const names = ["p_tenant_id", ...Object.keys(r.args(anything as never) as object)];
    if (r.command) names.push("p_idem_key", "p_request_hash", "p_request_id");
    expect(names.sort()).toEqual([...sqlParams(r.rpc)].sort());
  });
  it("RPCs do dono revogam anon, são SECURITY DEFINER e autorizam o dono; as de backend só o papel de serviço", () => {
    for (const r of Object.values(MESSAGING_ROUTES)) {
      expect(sql, r.rpc).toMatch(new RegExp(`revoke all on function public\\.${r.rpc}\\([^)]*\\) from public, anon;`));
      const def = defOf(r.rpc);
      expect(def, r.rpc).toContain("security definer set search_path = ''");
      expect(def, r.rpc).toMatch(/begin\n {2}perform app\.ch_owner\(p_tenant_id\);/);
    }
    for (const fn of ["channel_webhook_ingest", "channel_dispatch_claim", "channel_dispatch_result", "channel_dispatch_unknown", "channel_sim_deliver"]) {
      expect(sql, fn).toMatch(new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon, authenticated;`));
      expect(sql, fn).toMatch(new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to service_role;`));
    }
  });
  it("comandos usam o nome da operação no claim de idempotência", () => {
    for (const [name, r] of Object.entries(MESSAGING_ROUTES)) {
      if (!r.command) continue;
      expect(defOf(r.rpc), name).toContain(`app.idempotency_claim(p_tenant_id, v_uid, '${name}'`);
    }
  });
  it("estados e eventos do banco = contrato; dedupe por (provider, external_event_id); código fora da Data API", () => {
    expect(sql).toContain("check (status in ('queued', 'sending', 'sent', 'delivered', 'read', 'failed', 'delivery_unknown', 'received'))");
    expect([...ChannelMessageStatus.options].sort()).toEqual(["delivered", "delivery_unknown", "failed", "queued", "read", "received", "sending", "sent"]);
    for (const e of ["channel.message.received.v1", "channel.message.failed.v1"]) {
      expect(EventType.options).toContain(e);
      expect(sql).toContain(`'${e}'`);
    }
    expect(sql).toMatch(/primary key \(provider, external_event_id\)/);
    expect(sql).not.toMatch(/grant select[^;]*channel_verifications[^;]*to authenticated/);
    expect(sql).toMatch(/create policy channel_messages_select_owner[^;]*array\['owner'\]/);
  });
});
