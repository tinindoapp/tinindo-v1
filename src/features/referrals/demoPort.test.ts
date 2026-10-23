import { beforeEach, describe, expect, it } from "vitest";
import { ReferralDashboardOutput } from "@contracts";
import { createDemoPort, resetDemoState } from "./demoPort.ts";

describe("demonstração de Indicações (mesmas regras do banco)", () => {
  beforeEach(() => resetDemoState());

  it("painel válido pelo contrato; aceite não concede; duplicidade bloqueada; uso real concede uma vez", async () => {
    const port = createDemoPort();
    const d = ReferralDashboardOutput.parse(await port.dashboard());
    expect(d.summary).toMatchObject({ invites: 4, claimed: 3, rewarded: 1, bonus_this_month: 50 });
    expect(d.invites.find((i) => i.invitee_name.startsWith("Rafael"))?.activation?.status).toBe("awaiting_activity");
    expect(d.invites.find((i) => i.invitee_name.startsWith("Marina de novo"))?.activation).toMatchObject({ status: "blocked", block_reason: "duplicate" });
    expect(await port.simulateActivity!()).toEqual({ rewarded: 1 });
    expect(await port.simulateActivity!()).toEqual({ rewarded: 0 });
    const after = await port.dashboard();
    expect(after.summary).toMatchObject({ rewarded: 2, bonus_this_month: 100 });
    expect((await port.rewards()).map((r) => r.amount)).toEqual([50, 50]);
    expect(JSON.stringify(after)).not.toMatch(/rating|score|ranking/);
  });
});
