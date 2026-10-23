import { beforeEach, describe, expect, it } from "vitest";
import { advanceDemoClock, createDemoPort, DEMO_CUSTOMERS, resetDemoState } from "./demoPort.ts";

const code = (p: Promise<unknown>) => p.then(() => "ok", (e: { code: string; field?: string }) => `${e.code}/${e.field ?? "-"}`);

describe("demonstração de Assinaturas (mesmas regras do banco)", () => {
  beforeEach(() => resetDemoState());

  it("adesão congela os termos e abre o 1º ciclo; uma por cliente e plano; mudar o plano não altera a assinatura", async () => {
    const port = createDemoPort();
    const [plan] = await port.plans();
    const s = await port.subscribe(plan!.id, DEMO_CUSTOMERS[0]!.id, "s1");
    expect(s).toMatchObject({ status: "active", cycles_count: 1, terms: { price_cents: 20000, sessions_per_cycle: 4 } });
    expect(s.current_cycle).toMatchObject({ cycle_no: 1, package: { remaining_credits: 4 }, receivable: { status: "open", amount_cents: 20000 } });
    expect(await code(port.subscribe(plan!.id, DEMO_CUSTOMERS[0]!.id, "s2"))).toBe("POLICY_REJECTED/subscription");
    expect(await code(port.savePlan({ plan_id: plan!.id, expected_version: 9, service_id: plan!.service_id, name: "x", sessions_per_cycle: 4, price_cents: 1 }, "p0"))).toBe("STALE_VERSION/-");
    const p2 = await port.savePlan({ plan_id: plan!.id, expected_version: plan!.version, service_id: plan!.service_id, name: plan!.name, sessions_per_cycle: 4, cycle_days: 30, price_cents: 25000 }, "p1");
    expect(p2).toMatchObject({ price_cents: 25000, subscribers: 1 });
    expect((await port.subscriptions())[0]!.terms.price_cents).toBe(20000);
    expect(await code(port.savePlan({ service_id: plan!.service_id, name: "ruim", sessions_per_cycle: 0, price_cents: 100 }, "p2"))).toBe("VALIDATION_ERROR/plan");
  });

  it("renova ao vencer (uma vez), cancelar no fim do ciclo encerra no vencimento, cancelar agora preserva o saldo", async () => {
    const port = createDemoPort();
    const [plan] = await port.plans();
    await port.subscribe(plan!.id, DEMO_CUSTOMERS[0]!.id, "s1");
    expect(await port.tick!()).toEqual({ renewed: 0, closed: 0 });
    advanceDemoClock(31 * 86_400_000);
    expect(await port.tick!()).toEqual({ renewed: 1, closed: 0 });
    expect(await port.tick!()).toEqual({ renewed: 0, closed: 0 });
    let s = (await port.subscriptions())[0]!;
    expect(s.cycles_count).toBe(2);
    expect((await port.cycles(s.id)).map((c) => c.cycle_no)).toEqual([2, 1]);
    s = await port.cancel(s, true, "mudou", "c1");
    expect(s.cancel_at_period_end).toBe(true);
    s = await port.resume(s, "r1");
    expect(s.cancel_at_period_end).toBe(false);
    expect((await port.cancel(s, true, null, "c2")).cancel_at_period_end).toBe(true);
    advanceDemoClock(31 * 86_400_000);
    expect(await port.tick!()).toEqual({ renewed: 0, closed: 1 });
    expect((await port.subscriptions())[0]!.status).toBe("cancelled");
    const t = await port.subscribe(plan!.id, DEMO_CUSTOMERS[1]!.id, "s3");
    const now = await port.cancel(t, false, null, "c3");
    expect(now.status).toBe("cancelled");
    expect(now.current_cycle?.package.remaining_credits).toBe(4);
    expect(await code(port.resume(now, "r2"))).toBe("POLICY_REJECTED/status");
  });
});
