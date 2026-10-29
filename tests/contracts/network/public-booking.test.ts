// P43 · Reserva pelo link: registro v1 ↔ rotas da função `network` ↔ RPCs da migration; invariantes de exposição.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { OPERATIONS, PublicBookOutput, PublicConfirmOutput, PublicService } from "@contracts";

const sql = readFileSync(new URL("../../../supabase/migrations/20261026164500_p43_public_booking.sql", import.meta.url), "utf8");
const handler = readFileSync(new URL("../../../supabase/functions/network/handler.ts", import.meta.url), "utf8");
function sqlParams(fn: string): string[] {
  const m = new RegExp(`create function public\\.${fn}\\(([\\s\\S]*?)\\)\\s*returns`, "m").exec(sql);
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
    expect(sql).toMatch(/revoke all on public\.public_booking_requests from anon, authenticated;/);
    expect(sql).not.toMatch(/create policy [a-z_]+ on public\.public_booking_requests/);
    expect(sql.match(/security definer set search_path = ''/g)?.length).toBeGreaterThanOrEqual(8);
  });

  it("respostas sem contato, código nem preço de lista", () => {
    // Recado #64, item 4: o único preço é o "a partir de" (price_from_cents), e só com "Mostrar preços" ligado.
    const shown = (schema: { shape: object }) => Object.keys(schema.shape).filter((k) => k !== "price_from_cents").join(" ");
    for (const schema of [PublicBookOutput, PublicConfirmOutput, PublicService]) {
      expect(shown(schema)).not.toMatch(/phone|contact|code|name_key|price|cents/);
    }
    const photo = readFileSync(new URL("../../../supabase/migrations/20261029034000_p09_profile_photo.sql", import.meta.url), "utf8");
    const services = photo.slice(photo.indexOf("create or replace function public.public_booking_services"));
    expect(services).toContain("case when v_prices then jsonb_build_object('price_from_cents', s.base_price_cents) else '{}'::jsonb end");
    expect(services).not.toMatch(/min_price_cents|estimated_cost_cents|fee_bps/);
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
