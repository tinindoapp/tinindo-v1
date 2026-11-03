// Harness da suíte de avaliação do assistente (tests/agent-evals, 40 casos, docs/05 "Orçamento e avaliação").
// Roda o motor real (supabase/functions/_shared/domain/agent) contra o mundo de fixtures, com o portão do
// servidor emulado (vínculo → franquia). Critério: 100% dos casos; os de aprovação/execução (AE-37…40)
// rodam no Postgres real e aqui só se confere que estão cobertos pelos testes de banco.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { runAgent } from "../../../supabase/functions/_shared/domain/agent/engine.ts";
import { judge, type Outcome, sideEffects } from "./judge.ts";
import { CASES, World } from "./world.ts";

const DB_CASES = new Set(["AE-37", "AE-38", "AE-39", "AE-40"]);

async function ask(world: World, actor: string, tenant: "A" | "B", text: string): Promise<Outcome> {
  const g = world.gate(actor, tenant);
  if (!g.ok) return { http_status: g.status, error_code: g.code };
  const result = await runAgent(text, world.context(tenant, g.role), world.data(tenant, g.role));
  if (result.draft) world.drafts += 1;
  return { http_status: 200, result };
}

describe("avaliação do assistente · 40 casos (docs/05)", () => {
  it("a suíte tem 40 casos e cobre as 7 categorias", () => {
    expect(CASES).toHaveLength(40);
    expect(new Set(CASES.map((c) => c.category)).size).toBe(7);
  });

  it.each(CASES.filter((c) => !DB_CASES.has(c.id)).map((c) => [`${c.id} ${c.severity} · ${c.title}`, c] as const))("%s", async (_t, c) => {
    const world = new World(c.setup);
    const errs: string[] = [];
    for (const [i, step] of c.steps.entries()) {
      expect(step.op).toBe("agent.ask");
      const o = await ask(world, c.setup.actor, step.tenant ?? c.setup.tenant, step.input.text);
      const stepExp = step.expect ?? (c.steps.length === 1 ? c.expected : {});
      errs.push(...judge(stepExp, o, world).map((e) => `passo ${i + 1}: ${e}${o.result ? `\n  texto: ${o.result.text}` : ""}`));
      if (c.steps.length > 1 && i === c.steps.length - 1) {
        // Expectativas globais de casos com vários passos valem para o último (texto/estado/proposta).
        const { side_effects: _se, quota_after: _q, ...rest } = c.expected;
        void _se;
        void _q;
        if (o.http_status === 200) errs.push(...judge({ ...rest, http_status: undefined }, o, world).map((e) => `final: ${e}`));
      }
    }
    errs.push(...sideEffects(c.expected, world));
    if (c.expected.quota_after) {
      expect(world.quota[c.setup.tenant as "A" | "B"]).toBe(c.expected.quota_after.per_tenant_month_remaining);
    }
    expect(errs, errs.join("\n")).toEqual([]);
  });

  it("AE-37…40 (aprovação duplicada, retry, corrida e aprovação velha) estão cobertos no Postgres real", () => {
    const pg = readFileSync(new URL("../../../supabase/tests/database/08_agent.test.sql", import.meta.url), "utf8");
    const conc = readFileSync(new URL("../../db-concurrency/08_agent.sh", import.meta.url), "utf8");
    for (const id of ["AE-37", "AE-38", "AE-40"]) expect(pg).toContain(id);
    expect(conc).toContain("AE-39");
  });
});
