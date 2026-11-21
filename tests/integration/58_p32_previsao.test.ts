// P32 bloco 5 · previsão pela função `analytics` com o banco real: só o dono lê; passa no contrato; com pouco histórico
// é "insufficient" e não traz número; nada é gravado.
import { afterAll, describe, expect, it } from "vitest";
import { ForecastOutput } from "../../supabase/functions/analytics/forecast.ts";
import { call, pool, sql, T, U } from "./harness.ts";

afterAll(() => pool.end());

const today = new Date().toISOString().slice(0, 10);

describe("P32 · previsão da próxima semana", () => {
  it("o dono lê; o retorno passa no contrato e não grava nada", async () => {
    const before = (await sql<{ n: number }>("select count(*)::int as n from public.bookings where tenant_id = $1", [T.A]))[0]!.n;
    const r = await call("analytics", "forecast.get", { as: U.ownerA, tenant: T.A, body: { ref: today } });
    expect(r.status).toBe(200);
    const f = ForecastOutput.parse(r.data);
    expect(f.weeks_needed).toBe(8);
    if (f.status === "insufficient") {
      expect(f.weeks_of_history).toBeLessThan(8);
      expect(f.days).toEqual([]);
      expect(f.accuracy).toBeNull();
    }
    expect(JSON.stringify(f)).not.toMatch(/@|\+55|customer|name/);
    const after = (await sql<{ n: number }>("select count(*)::int as n from public.bookings where tenant_id = $1", [T.A]))[0]!.n;
    expect(after).toBe(before);
  });

  it("dono de outro negócio, cliente e estranho recebem 403", async () => {
    for (const as of [U.ownerB, U.customerAB, U.outsider]) {
      const r = await call("analytics", "forecast.get", { as, tenant: T.A, body: { ref: today } });
      expect(r.status).toBe(403);
    }
  });

  it("semana futura ou data fora do formato é recusada", async () => {
    const future = new Date(Date.now() + 40 * 86400_000).toISOString().slice(0, 10);
    expect((await call("analytics", "forecast.get", { as: U.ownerA, tenant: T.A, body: { ref: future } })).status).toBe(400);
    expect((await call("analytics", "forecast.get", { as: U.ownerA, tenant: T.A, body: { ref: "21/11/2026" } })).status).toBe(400);
  });
});
