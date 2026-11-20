// Portas de servidor do Resultado contra o registro de contratos (ver harness.ts).
import { describe, expect, it } from "vitest";
import { createServerCostPort, createServerPort } from "../../../src/features/analytics/serverPort.ts";
import { exercisePort, TENANT, unusedOperations } from "./harness.ts";

const ID = "00000000-0000-4000-8000-0000000000a1";
const period = { starts_at: "2026-10-01T03:00:00Z", ends_at: "2026-11-01T03:00:00Z" };

describe("analytics · porta do servidor", () => {
  it("toda chamada bate com o registro de contratos", async () => {
    const calls = await exercisePort("analytics", (call) => createServerPort(call, TENANT), {
      now: (p) => p.now(),
      timezone: (p) => p.timezone(),
      metrics: async (p) => {
        await p.metrics(period, null);
        await p.metrics(period, ID);
      },
      baselines: (p) => p.baselines(),
      createBaseline: (p, key) => p.createBaseline("Antes da campanha", period, key),
    });
    // Custo de servir é da operação Tinindo: a rota do servidor não usa negócio (`tenant: false` no handler).
    const cost = await exercisePort("analytics", (call) => createServerCostPort(call), {
      costToServe: (p) => p.costToServe(period, 4500),
    }, { tenant: "none" });

    expect(calls.now).toEqual([]);
    expect(calls.metrics!.map((c) => c.body)).toEqual([{ period, baseline_id: null }, { period, baseline_id: ID }]);
    expect(calls.createBaseline![0]!.body).toEqual({ label: "Antes da campanha", period });
    // O custo-hora chega com o nome do contrato, não o do argumento.
    expect(cost.costToServe![0]!.body).toEqual({ period, hourly_cost_cents: 4500 });
    // As duas portas juntas alcançam todo o módulo.
    expect(unusedOperations("analytics", { ...calls, ...cost })).toEqual([]);
  });
});
