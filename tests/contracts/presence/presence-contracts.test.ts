// P17 · Coerência entre o registro v1, as rotas da função `presence` e as RPCs da migration; invariantes.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DeliveryKind, EventType, OPERATIONS, type OperationName, PresenceOverview, SiteSnapshot } from "@contracts";
import { PRESENCE_PUBLIC, PRESENCE_ROUTES } from "../../../supabase/functions/presence/handler.ts";
import { THEME } from "../../../supabase/functions/_shared/domain/presence/render.ts";

const dir = new URL("../../../supabase/migrations/", import.meta.url);
const sql = readdirSync(dir).filter((f) => /^\d{14}_p17_.*\.sql$/.test(f)).map((f) => readFileSync(new URL(f, dir), "utf8")).join("\n");
const tokens = readFileSync(new URL("../../../brand/tokens/tokens.css", import.meta.url), "utf8");
function sqlParams(fn: string): string[] {
  const m = new RegExp(`create function public\\.${fn}\\(([\\s\\S]*?)\\)\\s*returns`, "m").exec(sql);
  if (!m) throw new Error(`função ${fn} não encontrada`);
  return (m[1] ?? "").split(",").map((p) => p.trim().split(/\s+/)[0] ?? "").filter(Boolean);
}
const defOf = (fn: string) => sql.slice(sql.indexOf(`create function public.${fn}(`)).split(/\nend \$\$;/)[0]!;
const ops = (Object.keys(OPERATIONS) as OperationName[]).filter((n) => OPERATIONS[n].module === "presence");
const token = (name: string) => new RegExp(`--tn-color-${name}:\\s*(#[0-9A-Fa-f]{6})`).exec(tokens)?.[1]?.toUpperCase();

describe("presence · registro ↔ função ↔ SQL", () => {
  it("toda operação do módulo tem rota (dono/operação ou pública)", () => {
    expect([...Object.keys(PRESENCE_ROUTES), ...Object.keys(PRESENCE_PUBLIC)].sort()).toEqual([...ops].sort());
  });
  it.each(Object.keys(PRESENCE_ROUTES))("%s usa os mesmos schemas e o mesmo tipo do registro", (name) => {
    const r = PRESENCE_ROUTES[name]!;
    const op = OPERATIONS[name as OperationName];
    expect(r.input).toBe(op.input);
    expect(r.output).toBe(op.output);
    expect(r.command).toBe(op.kind === "command");
  });
  it("leitura pública usa os schemas do registro", () => {
    expect(PRESENCE_PUBLIC["presence.public_site"].input).toBe(OPERATIONS["presence.public_site"].input);
    expect(PRESENCE_PUBLIC["presence.public_site"].output).toBe(OPERATIONS["presence.public_site"].output);
    expect(sqlParams("presence_public_site")).toEqual(["p_slug", "p_host"]);
  });
  it.each(Object.entries(PRESENCE_ROUTES))("%s passa exatamente os parâmetros da RPC", (_n, r) => {
    const anything: unknown = new Proxy({}, { get: (_t, k) => (k === "action" ? "grant" : anything) });
    const names = ["p_tenant_id", ...Object.keys(r.args(anything as never) as object)];
    if (r.command) names.push("p_idem_key", "p_request_hash", "p_request_id");
    expect(names.sort()).toEqual([...sqlParams(r.rpc)].sort());
  });
  it("RPCs do dono: SECURITY DEFINER, anon revogado; resultado do DNS só para o backend", () => {
    for (const r of Object.values(PRESENCE_ROUTES)) {
      expect(sql, r.rpc).toMatch(new RegExp(`revoke all on function public\\.${r.rpc}\\([^)]*\\) from public, anon;`));
      expect(defOf(r.rpc), r.rpc).toContain("security definer set search_path = ''");
    }
    expect(sql).toMatch(/revoke all on function public\.presence_domain_record_check\([^)]*\) from public, anon, authenticated;/);
    expect(sql).toMatch(/grant execute on function public\.presence_domain_record_check\([^)]*\) to service_role;/);
  });
  it("comandos usam o nome da operação no claim de idempotência", () => {
    for (const [name, r] of Object.entries(PRESENCE_ROUTES)) {
      if (!r.command) continue;
      expect(defOf(r.rpc), name).toMatch(new RegExp(`app\\.idempotency_claim\\(p_tenant_id, v_(uid|op\\.user_id), '${name.replace(".", "\\.")}'`));
    }
  });
});

describe("presence · invariantes", () => {
  it("nenhum campo, tipo de entrega ou texto promete posição ou ranking", () => {
    const keys = JSON.stringify([Object.keys(PresenceOverview.shape), Object.keys(SiteSnapshot.shape), DeliveryKind.options]);
    expect(keys).not.toMatch(/rank|position|posi[cç][aã]o|rating|nota/i);
    expect(sql).not.toMatch(/aggregateRating|ranking garantido|primeira página/i);
  });
  it("o site lê só fontes públicas: nunca clientes, piso de preço ou custo", () => {
    const snap = sql.slice(sql.indexOf("create function app.prs_snapshot"), sql.indexOf("create function app.prs_hash"));
    expect(snap).not.toMatch(/public\.customers|min_price_cents|estimated_cost_cents|fee_bps|bookings/);
    expect(snap).toContain("p.published_at is null then return null");
  });
  it("domínio do cliente: Tinindo e domínios de teste recusados; um nome verificado por negócio", () => {
    expect(sql).toContain("create unique index presence_domains_verified_host on public.presence_domains (hostname) where status = 'verified';");
    expect(sql).toMatch(/tinindo\\\./);
  });
  it("eventos novos estão no catálogo", () => {
    expect(EventType.options).toEqual(expect.arrayContaining(["presence.site.published.v1", "presence.domain.verified.v1"]));
  });
  it("cores da página pública = tokens da marca (temas claro e escuro)", () => {
    expect(THEME.papel.bg).toBe(token("papel-50"));
    expect(THEME.papel.fg).toBe(token("tinta-950"));
    expect(THEME.papel.muted).toBe(token("tinta-600"));
    expect(THEME.papel.line).toBe(token("tinta-200"));
    expect(THEME.tinta.bg).toBe(token("tinta-950"));
    expect(THEME.tinta.card).toBe(token("tinta-900"));
    expect(THEME.tinta.muted).toBe(token("tinta-300"));
    expect(THEME.tinta.line).toBe(token("tinta-700"));
  });
});
