// P32 bloco 2 · funil do primeiro dia pela função `pilot` com o banco real: só a equipe Tinindo lê; o funil vem pela
// data real dos dados e nada de conteúdo sai.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PilotFunnelOutput, PilotPanelOutput } from "../../supabase/functions/pilot/contract.ts";
import { call, pool, sql, T, U } from "./harness.ts";

const OP = "c3200000-0000-4000-8000-0000000000f2";
beforeAll(async () => {
  await sql("insert into auth.users (id) values ($1) on conflict do nothing", [OP]);
  await sql("insert into public.platform_operators (user_id, display_name) values ($1, 'Operadora (exemplo)') on conflict do nothing", [OP]);
});
afterAll(async () => {
  await sql("delete from public.platform_operators where user_id = $1", [OP]);
  await pool.end();
});

describe("P32 · funil do primeiro dia", () => {
  it("dono de negócio recebe 403", async () => {
    const r = await call("pilot", "pilot.funnel", { as: U.ownerA, body: {} });
    expect(r.status).toBe(403);
  });

  it("a equipe vê o funil de cada negócio, com os sete passos e sem conteúdo", async () => {
    const r = await call("pilot", "pilot.funnel", { as: OP, body: {} });
    expect(r.status).toBe(200);
    const out = PilotFunnelOutput.parse(r.data);
    const a = out.businesses.find((b) => b.tenant_id === T.A)!;
    expect(a.steps.map((s) => s.key)).toEqual(["signup", "configured", "link_published", "first_booking", "first_service", "first_payment", "returned"]);
    expect(a.steps[0]).toMatchObject({ done: true, minutes_since_previous: null });
    expect(a.done).toBe(a.steps.filter((s) => s.done).length);
    expect(JSON.stringify(out)).not.toMatch(/\+55|@|cents/);
  });
});

describe("P32 · painel do piloto", () => {
  it("a equipe lê o painel da semana; só números e nomes de tela/operação", async () => {
    await call("analytics", "usage.record", { as: U.ownerA, tenant: T.A, body: { batch_id: crypto.randomUUID(), events: [
      { kind: "screen", name: "/app/agenda", outcome: null, code: null, at: new Date().toISOString() },
      { kind: "command", name: "scheduling/booking.cancel", outcome: "refused", code: "POLICY_REJECTED", at: new Date().toISOString() },
    ] } });
    const ends_at = new Date().toISOString();
    const starts_at = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const r = await call("pilot", "pilot.panel", { as: OP, body: { period: { starts_at, ends_at } } });
    expect(r.status).toBe(200);
    const out = PilotPanelOutput.parse(r.data);
    const a = out.businesses.find((b) => b.tenant_id === T.A)!;
    expect(a.usage.screens.some((s) => s.name === "/app/agenda")).toBe(true);
    expect(a.usage.problems.some((p) => p.code === "POLICY_REJECTED")).toBe(true);
    expect(JSON.stringify(out)).not.toMatch(/Cliente AB|cliente\.ab@|\+55/);
    expect((await call("pilot", "pilot.panel", { as: U.ownerA, body: { period: { starts_at, ends_at } } })).status).toBe(403);
  });
});
