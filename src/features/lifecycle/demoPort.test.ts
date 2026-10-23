import { beforeEach, describe, expect, it } from "vitest";
import { advanceDemoClock, createDemoPort, DEMO_CUSTOMERS, resetDemoState } from "./demoPort.ts";

const code = (p: Promise<unknown>) => p.then(() => "ok", (e: { code: string; field?: string }) => `${e.code}/${e.field ?? "-"}`);

describe("demonstração do Relacionamento (mesmas regras do banco)", () => {
  beforeEach(() => resetDemoState());

  it("fila de exemplo; compartilhar só passo manual e uma vez; cancelar só pendente; lembrete sai ao vencer", async () => {
    const port = createDemoPort();
    const list = await port.steps(null);
    expect(list.counts).toMatchObject({ sent: 1, scheduled: 2, manual: 2 });
    const manual = list.steps.find((s) => s.status === "manual")!;
    expect((await port.markShared(manual.id, "k1")).status).toBe("shared");
    expect(await code(port.markShared(manual.id, "k2"))).toBe("POLICY_REJECTED/status");
    const sent = list.steps.find((s) => s.status === "sent")!;
    expect(await code(port.cancelStep(sent.id, "k3"))).toBe("POLICY_REJECTED/status");
    expect(await port.tick!()).toMatchObject({ sent: 0 });
    advanceDemoClock(23 * 3_600_000);
    expect(await port.tick!()).toMatchObject({ sent: 1 }); // lembrete de 24 h da Ana (com canal)
    expect((await port.steps("sent")).steps).toHaveLength(2);
  });

  it("réguas: versão vista, valores válidos; teto diário adia", async () => {
    const port = createDemoPort();
    expect(await code(port.saveSettings({ daily_budget: 1 }, 99, "s0"))).toBe("STALE_VERSION/-");
    expect(await code(port.saveSettings({ reminder_hours: [5] }, 0, "s1"))).toBe("VALIDATION_ERROR/settings");
    const saved = await port.saveSettings({ daily_budget: 1 }, 0, "s2");
    expect(saved.settings).toMatchObject({ daily_budget: 1, version: 1 });
    advanceDemoClock(23 * 3_600_000);
    expect(await port.tick!()).toMatchObject({ sent: 0, deferred: 1 }); // já saiu 1 hoje
    expect((await port.steps("deferred")).steps[0]?.skip_reason).toBe("daily_budget");
  });

  it("reativação: só com consentimento de marketing e público visto; revogar cancela; segunda aprovação com hash velho é recusada", async () => {
    const port = createDemoPort();
    expect((await port.audience()).customers).toEqual([]);
    await port.setConsent(DEMO_CUSTOMERS[1]!.id, "marketing", true, "c1");
    await port.setConsent(DEMO_CUSTOMERS[2]!.id, "marketing", true, "c2");
    const a = await port.audience();
    expect(a.customers.map((c) => c.name)).toEqual(["Carlos (exemplo)", "Marina (exemplo)"]);
    expect(await code(port.approveCampaign("0".repeat(64), 10, "a0"))).toBe("STALE_VERSION/audience_hash");
    const camp = await port.approveCampaign(a.audience_hash, 1, "a1");
    expect(camp).toMatchObject({ audience_count: 2, scheduled: 1 });
    expect((await port.audience()).customers.map((c) => c.name)).toEqual(["Marina (exemplo)"]);
    expect(await code(port.approveCampaign(a.audience_hash, 1, "a2"))).toBe("STALE_VERSION/audience_hash");
    await port.setConsent(DEMO_CUSTOMERS[1]!.id, "marketing", false, "c3");
    expect((await port.steps("cancelled")).steps.find((s) => s.rule === "reactivation")?.skip_reason).toBe("consent_revoked");
    expect((await port.campaigns())[0]).toMatchObject({ skipped: 1 });
  });
});
