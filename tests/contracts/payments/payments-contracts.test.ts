// P14 · Coerência entre o registro v1, as rotas da função `payments` e as RPCs da migration.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ChargeStatus, OPERATIONS, type OperationName, PaymentSource } from "@contracts";
import { PAYMENTS_ROUTES } from "../../../supabase/functions/payments/handler.ts";

const dir = new URL("../../../supabase/migrations/", import.meta.url);
const sql = readdirSync(dir).filter((f) => /^\d{14}_p14_.*\.sql$/.test(f)).map((f) => readFileSync(new URL(f, dir), "utf8")).join("\n");
function sqlParams(fn: string): string[] {
  const m = new RegExp(`create function public\\.${fn}\\(([\\s\\S]*?)\\)\\s*returns`, "m").exec(sql);
  if (!m) throw new Error(`função ${fn} não encontrada`);
  return (m[1] ?? "").split(",").map((p) => p.trim().split(/\s+/)[0] ?? "").filter(Boolean);
}
const defOf = (fn: string) => sql.slice(sql.indexOf(`create function public.${fn}(`)).split(/\nend \$\$;|\n\$\$;/)[0]!;
const ops = (Object.keys(OPERATIONS) as OperationName[]).filter((n) => OPERATIONS[n].module === "payments");
/** Rotas com tratamento próprio na função (provedor antes/depois da RPC, token no corpo). */
const CUSTOM: Record<string, string> = { "payment.charge_create": "payment_charge_create", "payment.reconcile": "payment_reconcile", "payment.link_view": "payment_link_view", "payment.sim_pay": "payment_link_view" };

describe("payments · registro ↔ função ↔ SQL", () => {
  it("toda operação do módulo tem rota (rpc-handler ou própria)", () => {
    expect([...Object.keys(PAYMENTS_ROUTES), ...Object.keys(CUSTOM)].sort()).toEqual([...ops].sort());
  });
  it.each(Object.keys(PAYMENTS_ROUTES) as OperationName[])("%s usa os mesmos schemas e o mesmo tipo do registro", (name) => {
    const r = PAYMENTS_ROUTES[name]!;
    expect(r.input).toBe(OPERATIONS[name].input);
    expect(r.output).toBe(OPERATIONS[name].output);
    expect(r.command).toBe(OPERATIONS[name].kind === "command");
  });
  it.each(Object.entries(PAYMENTS_ROUTES))("%s passa exatamente os parâmetros da RPC", (_n, r) => {
    const anything: unknown = new Proxy({}, { get: () => anything });
    const names = ["p_tenant_id", ...Object.keys(r.args(anything as never) as object)];
    if (r.command) names.push("p_idem_key", "p_request_hash", "p_request_id");
    expect(names.sort()).toEqual([...sqlParams(r.rpc)].sort());
  });
  it("criação e conciliação: parâmetros da RPC conferem com o que a função monta", () => {
    expect(sqlParams("payment_charge_create").sort()).toEqual(["p_idem_key", "p_provider", "p_receivable_id", "p_request_hash", "p_request_id", "p_tenant_id"]);
    expect(sqlParams("payment_reconcile").sort()).toEqual(["p_day", "p_idem_key", "p_provider", "p_report", "p_request_hash", "p_request_id", "p_tenant_id"]);
    expect(sqlParams("payment_link_view")).toEqual(["p_token"]);
  });
  it("RPCs do dono: SECURITY DEFINER, dono autorizado, anon revogado; link: anon pode; backend: só o papel de serviço", () => {
    for (const fn of ["payment_charge_create", "payment_charge_cancel", "payment_charges_list", "payment_refund_request", "payment_reconcile", "payment_reconciliations_list"]) {
      expect(sql, fn).toMatch(new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon;`));
      const def = defOf(fn);
      expect(def, fn).toContain("security definer set search_path = ''");
      expect(def, fn).toMatch(/begin\n {2}perform app\.pay_owner\(p_tenant_id\);/);
    }
    expect(sql).toMatch(/grant execute on function public\.payment_link_view\(text\) to anon, authenticated;/);
    for (const fn of ["payment_webhook_ingest", "payment_charge_result", "payment_sync_claim", "payment_sync_result", "payment_refund_result", "payment_sim_transition", "payment_sim_report", "payment_charge_lookup"]) {
      expect(sql, fn).toMatch(new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon, authenticated;`));
      expect(sql, fn).toMatch(new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to service_role;`));
    }
  });
  it("comandos usam o nome da operação no claim de idempotência", () => {
    for (const [name, r] of Object.entries(PAYMENTS_ROUTES)) {
      if (!r.command) continue;
      expect(defOf(r.rpc), name).toContain(`app.idempotency_claim(p_tenant_id, v_uid, '${name}'`);
    }
    expect(defOf("payment_charge_create")).toContain("app.idempotency_claim(p_tenant_id, v_uid, 'payment.charge_create'");
    expect(defOf("payment_reconcile")).toContain("app.idempotency_claim(p_tenant_id, v_uid, 'payment.reconcile'");
  });
  it("estados = contrato; fonte do recebimento ganha 'provider'; dedupe por (provider, external_event_id); token só como hash", () => {
    expect(sql).toContain("check (status in ('creating', 'pending', 'paid', 'expired', 'cancelled', 'failed', 'unknown'))");
    expect([...ChargeStatus.options].sort()).toEqual(["cancelled", "creating", "expired", "failed", "paid", "pending", "unknown"]);
    expect(sql).toContain("check (source in ('manual', 'provider'))");
    expect([...PaymentSource.options]).toEqual(["manual", "provider"]);
    expect(sql).toMatch(/primary key \(provider, external_event_id\)/);
    expect(sql).toContain("app.token_sha256(v_token)");
    expect(sql).not.toMatch(/grant select[^;]*payment_sim_ledger[^;]*to authenticated/);
    expect(sql).not.toMatch(/grant select[^;]*payment_webhook_events[^;]*to authenticated/);
    expect(sql).toMatch(/create policy payment_charges_select_owner[^;]*array\['owner'\]/);
  });
});
