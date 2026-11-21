// P32 bloco 4 · relatório ao profissional pela função `analytics` com o banco real: só o dono lê o próprio negócio;
// o retorno passa no contrato, traz período e base de cada número e nunca dado de cliente.
import { afterAll, describe, expect, it } from "vitest";
import { ReportOutput } from "../../supabase/functions/analytics/report.ts";
import { call, pool, T, U } from "./harness.ts";

afterAll(() => pool.end());

const today = new Date().toISOString().slice(0, 10);

describe("P32 · relatório Sua semana / Seu mês", () => {
  it("o dono lê a semana e o mês; cada número traz denominador e estado", async () => {
    for (const kind of ["week", "month"] as const) {
      const r = await call("analytics", "report.get", { as: U.ownerA, tenant: T.A, body: { kind, ref: today } });
      expect(r.status).toBe(200);
      const out = ReportOutput.parse(r.data);
      expect(out.kind).toBe(kind);
      expect(out.in_progress).toBe(true);
      for (const m of [out.services_done, out.no_shows, out.returned, out.not_returned]) {
        expect(typeof m.denominator).toBe("number");
        expect(m.status === "insufficient" ? m.value === null : m.value !== null).toBe(true);
      }
      expect(JSON.stringify(out)).not.toMatch(/@|\+55|customer|name/);
    }
  });

  it("dono de outro negócio, cliente e estranho recebem 403", async () => {
    for (const as of [U.ownerB, U.customerAB, U.outsider]) {
      const r = await call("analytics", "report.get", { as, tenant: T.A, body: { kind: "week", ref: today } });
      expect(r.status).toBe(403);
    }
  });

  it("período fora do contrato ou no futuro é recusado", async () => {
    const bad = await call("analytics", "report.get", { as: U.ownerA, tenant: T.A, body: { kind: "ano", ref: today } });
    expect(bad.status).toBe(400);
    const future = new Date(Date.now() + 40 * 86400_000).toISOString().slice(0, 10);
    const fut = await call("analytics", "report.get", { as: U.ownerA, tenant: T.A, body: { kind: "week", ref: future } });
    expect(fut.status).toBe(400);
  });
});
