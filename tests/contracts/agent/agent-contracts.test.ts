// P08 · Coerência entre o registro v1, a função `agent`, as RPCs da migration e o catálogo fechado de ferramentas.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AgentTool, OPERATIONS, type OperationName } from "@contracts";
import { AGENT_ACTION_ROUTES } from "../../../supabase/functions/agent/handler.ts";

const dir = new URL("../../../supabase/migrations/", import.meta.url);
const sql = readdirSync(dir)
  .filter((f) => /^\d{14}_p08_.*\.sql$/.test(f))
  .map((f) => readFileSync(new URL(f, dir), "utf8"))
  .join("\n");
const fnDef = (fn: string) => sql.slice(sql.indexOf(`create function public.${fn}(`)).split(/\nend \$\$;/)[0]!;

function sqlParams(fn: string): string[] {
  const m = new RegExp(`create function public\\.${fn}\\(([\\s\\S]*?)\\)\\s*returns`, "m").exec(sql);
  if (!m?.[1]) throw new Error(`função ${fn} não encontrada`);
  return m[1].split(",").map((p) => p.trim().split(/\s+/)[0] ?? "").filter(Boolean);
}

const agentOps = (Object.keys(OPERATIONS) as OperationName[]).filter((n) => OPERATIONS[n].module === "agent");

describe("agent · registro ↔ função", () => {
  it("as operações do módulo são agent.ask (rota própria) + aprovar/executar", () => {
    expect([...agentOps].sort()).toEqual(["action.approve", "action.execute", "agent.ask"]);
    expect(Object.keys(AGENT_ACTION_ROUTES).sort()).toEqual(["action.approve", "action.execute"]);
  });

  it.each(Object.entries(AGENT_ACTION_ROUTES))("%s usa os schemas do registro e os parâmetros exatos da RPC", (name, route) => {
    expect(route.input).toBe(OPERATIONS[name as OperationName].input);
    expect(route.output).toBe(OPERATIONS[name as OperationName].output);
    expect(route.command).toBe(true);
    const anything: unknown = new Proxy({}, { get: () => anything });
    const names = ["p_tenant_id", ...Object.keys(route.args(anything as never) as object), "p_idem_key", "p_request_hash", "p_request_id"];
    expect(names.sort()).toEqual([...sqlParams(route.rpc)].sort());
    expect(fnDef(route.rpc)).toContain(`app.idempotency_claim(p_tenant_id, v_uid, '${name}'`);
    expect(fnDef(route.rpc)).toContain(`app.idempotency_complete(p_tenant_id, v_uid, '${name}'`);
  });
});

describe("agent · SQL", () => {
  const rpcs = ["agent_run_start", "agent_agenda_read", "agent_directory", "agent_finance_read", "agent_proposal_create",
    "action_approve", "action_execute"];

  it.each(rpcs)("%s: SECURITY DEFINER, search_path vazio, sem anon", (fn) => {
    expect(fnDef(fn)).toContain("security definer set search_path = ''");
    expect(sql).toMatch(new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon;`));
    expect(sql).toMatch(new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to authenticated;`));
  });

  it("aprovar e executar são só do dono; ler exige vínculo", () => {
    for (const fn of ["agent_proposal_create", "action_approve", "action_execute"]) expect(fnDef(fn)).toContain("perform app.agent_owner(p_tenant_id)");
    expect(fnDef("agent_finance_read")).toContain("perform app.fin_owner(p_tenant_id)");
    expect(fnDef("agent_agenda_read")).toContain("app.is_member(p_tenant_id)");
  });

  it("ferramentas que viram ação: lista fechada no banco ⊂ catálogo AgentTool", () => {
    const m = /tool text not null check \(tool in \(([^)]*)\)\)/.exec(sql);
    const tools = (m?.[1] ?? "").split(",").map((s) => s.trim().replaceAll("'", ""));
    expect(tools.sort()).toEqual(["booking.cancel", "booking.create", "booking.reschedule", "pricing.propose_rule"]);
    for (const t of tools) expect(AgentTool.options).toContain(t);
  });

  it("uma aprovação por proposta, append-only, e recibo único por aprovação", () => {
    expect(sql).toContain("unique (tenant_id, proposal_id),");
    expect(sql).toContain("create trigger agent_approvals_append_only before update or delete on public.agent_approvals");
    expect(sql).toContain("create trigger agent_receipts_append_only before update or delete on public.agent_receipts");
    expect(sql).toContain("approval_id uuid primary key,");
  });

  it("execução usa as funções do módulo dono do dado, com origem 'agent', nunca SQL dinâmico", () => {
    const exec = sql.slice(sql.indexOf("create function app.agent_execute("), sql.indexOf("-- RPCs de leitura"));
    expect(exec).toContain("app.sched_insert_booking(");
    expect(exec).toContain("'confirm', 'agent'");
    expect(exec).toContain("public.scheduling_booking_reschedule(");
    expect(exec).toContain("public.scheduling_booking_cancel(");
    expect(exec).toContain("public.pricing_propose_rule(");
    expect(sql).not.toMatch(/\bexecute\s+(format|'|\$|v_)/i);
  });

  it("evento agent.action.approved.v1 só na aprovação", () => {
    expect(fnDef("action_approve")).toContain("'agent.action.approved.v1'");
    expect(fnDef("action_execute")).not.toContain("agent.action.approved.v1");
  });

  it("a saída das RPCs tem os campos dos contratos", () => {
    const fields = (fn: string) => [...sql.slice(sql.indexOf(`create function app.${fn}(`)).split("$$;")[0]!.matchAll(/'([a-z_]+)', /g)].map((m) => m[1]);
    expect(fields("agent_proposal_json").sort()).toEqual(
      ["approval_state", "expires_at", "payload", "payload_hash", "policy_version", "proposal_id", "summary", "tenant_id", "tool", "version"].sort());
    expect(fields("agent_approval_json").sort()).toEqual(["approval_id", "approved_at", "approver_user_id", "expires_at", "proposal_id"].sort());
    expect(fields("agent_receipt_json")).toEqual(expect.arrayContaining(["approval_id", "status", "result_ref", "executed_at"]));
  });
});
