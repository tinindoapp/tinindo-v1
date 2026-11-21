// P32 bloco 1 · uso do app pela função `analytics` com o banco real: o lote grava só vocabulário fechado, não
// duplica, não cruza negócios, e desligar a medição para de gravar e apaga o que havia.
import { afterAll, describe, expect, it } from "vitest";
import { call, newKey, pool, sql, T, U } from "./harness.ts";

afterAll(() => pool.end());

const at = () => new Date().toISOString();
const events = [
  { kind: "screen", name: "/app/clientes/30000000-0000-4000-8000-0000000000a1", outcome: null, code: null, at: at() },
  { kind: "command", name: "scheduling/booking.create", outcome: "ok", code: null, at: at() },
  { kind: "command", name: "scheduling/booking.cancel", outcome: "refused", code: "POLICY_REJECTED", at: at() },
  { kind: "screen", name: "/app/clientes/maria.silva@exemplo.com", outcome: null, code: null, at: at() },
];

describe("P32 · uso do app", () => {
  it("o dono grava o lote; o id vira :id; o mesmo lote não grava duas vezes", async () => {
    const batch_id = crypto.randomUUID();
    const r = await call("analytics", "usage.record", { as: U.ownerA, tenant: T.A, body: { batch_id, events } });
    expect(r.status).toBe(200);
    expect(r.data).toMatchObject({ recorded: 4, enabled: true });
    const again = await call("analytics", "usage.record", { as: U.ownerA, tenant: T.A, body: { batch_id, events } });
    expect(again.data).toMatchObject({ recorded: 0, duplicate: true });
    const rows = await sql<{ name: string }>("select name from public.usage_events where tenant_id = $1 and kind = 'screen'", [T.A]);
    expect(rows.map((x) => x.name)).toEqual(["/app/clientes/:id", "/app/clientes/:id"]);
    expect(JSON.stringify(await sql("select * from public.usage_events where tenant_id = $1", [T.A]))).not.toMatch(/maria|@|30000000/);
  });

  it("dono de outro negócio não grava em A", async () => {
    const r = await call("analytics", "usage.record", { as: U.ownerB, tenant: T.A, body: { batch_id: crypto.randomUUID(), events } });
    expect(r.status).toBe(403);
  });

  it("desligar para de gravar e apaga o medido; ligar de novo volta a gravar", async () => {
    const before = await call("analytics", "usage.settings", { as: U.ownerA, tenant: T.A, body: {} });
    expect(before.data).toMatchObject({ enabled: true, retention_days: 30 });
    const off = await call("analytics", "usage.settings_set", { as: U.ownerA, tenant: T.A, key: newKey(), body: { enabled: false, expected_version: (before.data as { version: number }).version } });
    expect(off.data).toMatchObject({ enabled: false });
    expect((await sql<{ n: number }>("select count(*)::int as n from public.usage_events where tenant_id = $1", [T.A]))[0]!.n).toBe(0);
    const skipped = await call("analytics", "usage.record", { as: U.ownerA, tenant: T.A, body: { batch_id: crypto.randomUUID(), events } });
    expect(skipped.data).toMatchObject({ recorded: 0, enabled: false });
    const on = await call("analytics", "usage.settings_set", { as: U.ownerA, tenant: T.A, key: newKey(), body: { enabled: true, expected_version: (off.data as { version: number }).version } });
    expect(on.data).toMatchObject({ enabled: true });
    const back = await call("analytics", "usage.record", { as: U.ownerA, tenant: T.A, body: { batch_id: crypto.randomUUID(), events: events.slice(0, 1) } });
    expect(back.data).toMatchObject({ recorded: 1 });
  });
});
