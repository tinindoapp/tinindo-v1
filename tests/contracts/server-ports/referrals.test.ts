// Porta de servidor de Indicações contra o registro de contratos (ver harness.ts).
import { describe, expect, it } from "vitest";
import { createServerPort } from "../../../src/features/referrals/serverPort.ts";
import { exercisePort, TENANT, unusedOperations } from "./harness.ts";

describe("referrals · porta do servidor", () => {
  it("toda chamada bate com o registro de contratos", async () => {
    const calls = await exercisePort("referrals", (call) => createServerPort(call, TENANT), {
      dashboard: (p) => p.dashboard(),
      rewards: (p) => p.rewards(),
    });

    // Leituras do dono: corpo vazio, sem chave.
    expect(calls.dashboard![0]).toMatchObject({ path: "/referrals/referrals.dashboard", method: "POST", body: {}, idempotencyKey: undefined });
    expect(calls.rewards![0]).toMatchObject({ path: "/referrals/referrals.rewards", method: "POST", body: {}, idempotencyKey: undefined });
    expect(unusedOperations("referrals", calls)).toEqual([]);
  });
});
