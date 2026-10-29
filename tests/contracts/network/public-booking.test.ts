// P43 · Reserva pelo link: registro v1 ↔ rotas da função `network` ↔ RPCs da migration; invariantes de exposição.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { OPERATIONS, PublicBookOutput, PublicConfirmOutput, PublicService } from "@contracts";

const sql = readFileSync(new URL("../../../supabase/migrations/20261026164500_p43_public_booking.sql", import.meta.url), "utf8");
// Troca do pedido pendente (recado #64, item 5): recria public_booking_request com p_replace_existing.
const replace = readFileSync(new URL("../../../supabase/migrations/20261029033000_p43_replace_pending_request.sql", import.meta.url), "utf8");
const handler = readFileSync(new URL("../../../supabase/functions/network/handler.ts", import.meta.url), "utf8");
/** Parâmetros da definição mais recente da função (a migration da troca vence a original). */
function sqlParams(fn: string): string[] {
  const re = new RegExp(`create function public\\.${fn}\\(([\\s\\S]*?)\\)\\s*returns`, "m");
  const m = re.exec(replace) ?? re.exec(sql);
  if (!m) throw new Error(`função ${fn} não encontrada`);
  return (m[1] ?? "").split(",").map((p) => p.trim().split(/\s+/)[0] ?? "").filter(Boolean);
}
/** Argumentos que o handler passa para a RPC (bloco `call("fn", { ... }`). */
function handlerArgs(fn: string): string[] {
  const m = new RegExp(`call\\("${fn}", \\{([\\s\\S]*?)\\}, (?:true|false)\\)`).exec(handler);
  if (!m) throw new Error(`chamada ${fn} não encontrada no handler`);
  return [...(m[1] ?? "").matchAll(/(p_[a-z_]+)\s*:/g)].map((x) => x[1]!);
}

describe("P43 · registro ↔ handler ↔ SQL", () => {
  it("operações do link público com dono P43; só o contato é do dono", () => {
    for (const name of ["public.services", "public.book", "public.confirm", "public.contact"] as const) {
      expect(OPERATIONS[name]).toMatchObject({ module: "network", owner: "P43" });
    }
    expect(OPERATIONS["public.book"].kind).toBe("command");
    expect(OPERATIONS["public.confirm"].kind).toBe("command");
    expect(OPERATIONS["public.services"].kind).toBe("query");
    expect(OPERATIONS["public.contact"].kind).toBe("query");
    expect(sql).toMatch(/revoke all on function public\.public_booking_contact\(uuid, uuid\) from public, anon;/);
    expect(sql).not.toMatch(/grant execute on function public\.public_booking_contact\([^)]*\) to anon/);
    const contactFn = sql.slice(sql.indexOf("create function public.public_booking_contact"), sql.indexOf("-- Despacho (P12 estendido)"));
    expect(contactFn).toContain("app.is_member(p_tenant_id, array['owner'])");
  });

  it.each([
    ["public_booking_services"],
    ["public_booking_request"],
    ["public_booking_confirm"],
    ["public_booking_contact"],
  ])("%s recebe exatamente os parâmetros da função SQL", (fn) => {
    expect(handlerArgs(fn).sort()).toEqual(sqlParams(fn).sort());
  });

  it("anon executa as três; tabela de pedidos sem acesso pela Data API; SECURITY DEFINER", () => {
    for (const fn of ["public_booking_services", "public_booking_request", "public_booking_confirm"]) {
      expect(sql).toMatch(new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon, authenticated;`));
      expect(sql).toMatch(new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to anon, authenticated;`));
    }
    for (const grant of ["revoke all on function public\\.public_booking_request\\([^)]*boolean\\) from public, anon, authenticated;",
      "grant execute on function public\\.public_booking_request\\([^)]*boolean\\) to anon, authenticated;"]) {
      expect(replace).toMatch(new RegExp(grant));
    }
    expect(sql).toMatch(/revoke all on public\.public_booking_requests from anon, authenticated;/);
    expect(sql).not.toMatch(/create policy [a-z_]+ on public\.public_booking_requests/);
    expect(sql.match(/security definer set search_path = ''/g)?.length).toBeGreaterThanOrEqual(8);
  });

  it("respostas sem contato, código nem preço de lista", () => {
    for (const schema of [PublicBookOutput, PublicConfirmOutput, PublicService]) {
      expect(Object.keys(schema.shape).join(" ")).not.toMatch(/phone|contact|code|name_key|price|cents/);
    }
    const reqJson = sql.slice(sql.indexOf("create function app.pbk_request_json"), sql.indexOf("create function app.pbk_confirmed_json"));
    expect(reqJson).not.toMatch(/contact_|code/);
  });

  it("código com sorteio criptográfico sem viés, nunca random()", () => {
    expect(sql).toContain("extensions.gen_random_bytes(4)");
    expect(sql).toContain("exit when v < 4294000000;");
    expect(sql).not.toMatch(/\brandom\(\)/);
    expect(4294000000 % 1_000_000).toBe(0);
    expect(4294000000).toBeLessThanOrEqual(2 ** 32);
  });

  it("o código só sai pelo despacho do canal, com o modelo próprio", () => {
    expect(sql).toContain("('codigo_reserva', 'utility'");
    expect(sql).toMatch(/'ref', 'pbk:' \|\| r\.id/);
    expect(sql).toMatch(/if p_ref like 'pbk:%' then/);
  });
});
