// P16 · Coerência entre o registro v1, as rotas da função `fiscal` e as RPCs da migration; invariantes.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EventType, FiscalDocument, OPERATIONS, type OperationName } from "@contracts";
import { FISCAL_ROUTES } from "../../../supabase/functions/fiscal/handler.ts";

const dir = new URL("../../../supabase/migrations/", import.meta.url);
const sql = readdirSync(dir).filter((f) => /^\d{14}_p16_.*\.sql$/.test(f)).map((f) => readFileSync(new URL(f, dir), "utf8")).join("\n");
function sqlParams(fn: string): string[] {
  const m = new RegExp(`create function public\\.${fn}\\(([\\s\\S]*?)\\)\\s*returns`, "m").exec(sql);
  if (!m) throw new Error(`função ${fn} não encontrada`);
  return (m[1] ?? "").split(",").map((p) => p.trim().split(/\s+/)[0] ?? "").filter(Boolean);
}
const defOf = (fn: string) => sql.slice(sql.indexOf(`create function public.${fn}(`)).split(/\nend \$\$;/)[0]!;
const ops = (Object.keys(OPERATIONS) as OperationName[]).filter((n) => OPERATIONS[n].module === "fiscal");

describe("fiscal · registro ↔ função ↔ SQL", () => {
  it("toda operação do módulo tem rota", () => {
    expect(Object.keys(FISCAL_ROUTES).sort()).toEqual([...ops].sort());
  });
  it.each(Object.keys(FISCAL_ROUTES))("%s usa os mesmos schemas e o mesmo tipo do registro", (name) => {
    const r = FISCAL_ROUTES[name]!;
    const op = OPERATIONS[name as OperationName];
    expect(r.input).toBe(op.input);
    expect(r.output).toBe(op.output);
    expect(r.command).toBe(op.kind === "command");
  });
  it.each(Object.entries(FISCAL_ROUTES))("%s passa exatamente os parâmetros da RPC", (_n, r) => {
    const anything: unknown = new Proxy({}, { get: (_t, k) => (k === "action" ? "grant" : anything) });
    const names = ["p_tenant_id", ...Object.keys(r.args(anything as never) as object)];
    if (r.command) names.push("p_idem_key", "p_request_hash", "p_request_id");
    expect(names.sort()).toEqual([...sqlParams(r.rpc)].sort());
  });
  it("RPCs do dono: SECURITY DEFINER, anon revogado; resultados do provedor só para o backend", () => {
    for (const r of Object.values(FISCAL_ROUTES)) {
      expect(sql, r.rpc).toMatch(new RegExp(`revoke all on function public\\.${r.rpc}\\([^)]*\\) from public, anon;`));
      expect(defOf(r.rpc), r.rpc).toContain("security definer set search_path = ''");
    }
    for (const fn of ["fiscal_credential_record", "fiscal_emit_result", "fiscal_cancel_result", "fiscal_sync_claim"]) {
      expect(sql, fn).toMatch(new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon, authenticated;`));
    }
  });
  it("comandos usam o nome da operação no claim de idempotência", () => {
    for (const [name, r] of Object.entries(FISCAL_ROUTES)) {
      if (!r.command) continue;
      expect(defOf(r.rpc), name).toContain(`app.idempotency_claim(p_tenant_id, v_uid, '${name}'`);
    }
  });
});

describe("fiscal · invariantes", () => {
  it("emitir não é pagamento: nenhuma função fiscal escreve em recebível, recebimento ou caixa", () => {
    expect(sql).not.toMatch(/(update|insert into|delete from)\s+public\.(receivables|payment_entries|payment_charges|expenses)/i);
  });
  it("produção não se liga pelo app: nenhuma RPC escreve production_enabled = true", () => {
    expect(sql).not.toMatch(/production_enabled\s*=\s*true/);
  });
  it("o documento do tomador nunca sai da leitura (só mascarado)", () => {
    expect(Object.keys(FiscalDocument.shape)).not.toContain("taker_document");
    expect(Object.keys(FiscalDocument.shape)).toContain("taker_document_masked");
  });
  it("nenhum certificado ou senha é guardado", () => {
    expect(sql).not.toMatch(/certificate_(data|blob|pem)|password|senha\s+text|pfx/i);
  });
  it("evento novo no catálogo", () => {
    expect(EventType.options).toContain("fiscal.document.authorized.v1");
  });
});
