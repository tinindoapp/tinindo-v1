// P11 · Coerência entre o registro v1, as rotas da função `sales` e as RPCs da migration.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BookingSource, EventType, OPERATIONS, type OperationName, SalesQuoteStatus } from "@contracts";
import { SALES_PUBLIC_ROUTES, SALES_ROUTES } from "../../../supabase/functions/sales/handler.ts";

const dir = new URL("../../../supabase/migrations/", import.meta.url);
const sql = readdirSync(dir)
  .filter((f) => /^\d{14}_p11_.*\.sql$/.test(f))
  .map((f) => readFileSync(new URL(f, dir), "utf8"))
  .join("\n");

function sqlParams(fn: string): string[] {
  const m = new RegExp(`create function public\\.${fn}\\(([\\s\\S]*?)\\)\\s*returns`, "m").exec(sql);
  if (!m?.[1]) throw new Error(`função ${fn} não encontrada`);
  return m[1].split(",").map((p) => p.trim().split(/\s+/)[0] ?? "").filter(Boolean);
}
const defOf = (fn: string) => sql.slice(sql.indexOf(`create function public.${fn}(`)).split(/\nend \$\$;/)[0]!;
const anything: unknown = new Proxy({}, {
  get: (_t, k) => (k === "items" ? [] : k === "map" ? () => [] : anything),
});

const salesOps = (Object.keys(OPERATIONS) as OperationName[]).filter((n) => OPERATIONS[n].module === "sales");

describe("sales · registro ↔ função", () => {
  it("toda operação do módulo no registro tem rota (dono ou link), e vice-versa", () => {
    expect([...Object.keys(SALES_ROUTES), ...Object.keys(SALES_PUBLIC_ROUTES)].sort()).toEqual([...salesOps].sort());
  });

  it.each(salesOps)("%s usa os mesmos schemas e o mesmo tipo do registro", (name) => {
    const route = SALES_ROUTES[name] ?? SALES_PUBLIC_ROUTES[name]!;
    expect(route.input).toBe(OPERATIONS[name].input);
    expect(route.output).toBe(OPERATIONS[name].output);
    const r = route as { command?: boolean; needsKey?: boolean };
    const command = r.command ?? r.needsKey;
    expect(command).toBe(OPERATIONS[name].kind === "command");
  });
});

describe("sales · função ↔ SQL", () => {
  it.each(Object.entries(SALES_ROUTES))("%s passa exatamente os parâmetros da RPC", (_name, route) => {
    const built = route.args(anything as never);
    expect(built).not.toBe(false);
    const names = ["p_tenant_id", ...Object.keys(built as object)];
    if (route.command) names.push("p_idem_key", "p_request_hash", "p_request_id");
    expect(names.sort()).toEqual([...sqlParams(route.rpc)].sort());
  });

  it.each(Object.entries(SALES_PUBLIC_ROUTES))("%s (link) passa exatamente os parâmetros da RPC", (_name, route) => {
    expect(Object.keys(route.args(anything as never)).sort()).toEqual([...sqlParams(route.rpc)].sort());
  });

  it("RPCs do dono revogam anon, são SECURITY DEFINER e autorizam o dono primeiro", () => {
    for (const route of Object.values(SALES_ROUTES)) {
      expect(sql, route.rpc).toMatch(new RegExp(`revoke all on function public\\.${route.rpc}\\([^)]*\\) from public, anon;`));
      const def = defOf(route.rpc);
      expect(def, route.rpc).toContain("security definer set search_path = ''");
      expect(def, route.rpc).toMatch(/begin\n {2}perform app\.sales_owner\(p_tenant_id\);/);
    }
  });

  it("comandos do dono usam o nome da operação no claim de idempotência", () => {
    for (const [name, route] of Object.entries(SALES_ROUTES)) {
      if (!route.command) continue;
      const def = defOf(route.rpc);
      expect(def, name).toContain(`app.idempotency_claim(p_tenant_id, v_uid, '${name}'`);
      expect(def, name).toContain(`app.idempotency_complete(p_tenant_id, v_uid, '${name}'`);
    }
  });

  it("aceite trava o orçamento, confere versão + hash + validade e reserva pela agenda", () => {
    const def = defOf("sales_quote_accept");
    expect(def).toContain("for update");
    expect(def).toContain("v_v.snapshot_hash <> p_snapshot_hash");
    expect(def).toContain("v_v.valid_until <= clock_timestamp()");
    expect(def).toContain("app.sched_insert_booking(");
    // Aceito ≠ pago: nenhuma escrita no caixa.
    expect(def).not.toMatch(/payment_entries|receivables|finance_/);
  });

  it("estados, origem da reserva e eventos do banco = contrato", () => {
    expect(sql).toContain("check (status in ('draft', 'sent', 'accepted', 'declined', 'cancelled'))");
    expect([...SalesQuoteStatus.options].sort()).toEqual(["accepted", "cancelled", "declined", "draft", "expired", "sent"]);
    expect(BookingSource.options).toContain("quote");
    expect(sql).toContain("'import', 'quote'");
    for (const e of ["sales.quote.accepted.v1", "sales.quote.declined.v1"]) {
      expect(EventType.options).toContain(e);
      expect(sql).toContain(`'${e}'`);
    }
  });

  it("versões e decisões são append-only; leitura só do dono; hash do token fora da leitura", () => {
    for (const t of ["sales_quote_versions", "sales_quote_decisions"]) {
      expect(sql).toMatch(new RegExp(`create trigger ${t}_append_only before update or delete on public\\.${t}`));
    }
    const policies = [...sql.matchAll(/create policy \w+ on public\.(\w+)\s+for select to authenticated using \(([^;]+)\);/g)];
    expect(policies.length).toBe(3);
    for (const [, table, using] of policies) expect(using, table).toContain("array['owner']");
    const grant = /grant select \(([^)]*)\) on public\.sales_quotes to authenticated/.exec(sql)?.[1] ?? "";
    expect(grant).not.toContain("token_hash");
  });
});
