import { beforeEach, describe, expect, it } from "vitest";
import { createDemoOpsPort, createDemoPort, DEMO_OPERATOR, resetDemoState } from "./demoPort.ts";

const code = (p: Promise<unknown>) => p.then(() => "ok", (e: { code: string }) => e.code);

describe("demonstração de Plano e serviços (mesmas regras do banco)", () => {
  beforeEach(() => resetDemoState());

  it("plano: versão vista, sem repetir o mesmo plano", async () => {
    const port = createDemoPort();
    const p = await port.plan();
    expect(p.plan.code).toBe("free");
    const founder = p.catalog.find((c) => c.code === "founder")!;
    expect(await code(port.subscribe({ ...founder, scope_hash: "0".repeat(64) }, "k0"))).toBe("STALE_VERSION");
    expect((await port.subscribe(founder, "k1")).subscription?.price_cents).toBe(7900);
    expect(await code(port.subscribe(founder, "k2"))).toBe("POLICY_REJECTED");
  });

  it("pedido: sem acesso não começa nem lê; minutos com teto; aprovar revoga o acesso", async () => {
    const port = createDemoPort();
    const ops = createDemoOpsPort();
    const svc = (await port.plan()).catalog.find((c) => c.kind === "service")!;
    const order = await port.request(svc, null, "r1");
    let q = (await ops.queue()).orders[0]!;
    await ops.assign(q, DEMO_OPERATOR.user_id, "a1");
    q = (await ops.queue()).orders[0]!;
    expect(q.status).toBe("awaiting_access");
    expect(await code(ops.start(q, "s0"))).toBe("POLICY_REJECTED");
    expect(await code(ops.snapshot(q))).toBe("FORBIDDEN");
    await port.grant(order, ["catalog"], "2026-10-25T12:00:00Z", "Cadastro", "g1");
    expect(await code(port.grant(order, ["catalog"], "2026-12-25T12:00:00Z", "Cadastro", "g2"))).toBe("VALIDATION_ERROR");
    q = (await ops.queue()).orders[0]!;
    await ops.start(q, "s1");
    expect((await ops.snapshot(q)).customers).toBeNull();
    await ops.logWork(q, 100, "human", false, null, "w1");
    expect(await code(ops.logWork(q, 21, "human", false, null, "w2"))).toBe("QUOTA_EXCEEDED");
    await ops.logWork(q, 100, "human", false, null, "w1");
    await ops.deliver(q, "Cadastro", "Feito", "d1");
    const [detail] = await port.orders();
    expect(detail!.minutes_used).toBe(100);
    await port.review(detail!, detail!.deliverables[0]!.id, "approved", null, "v1");
    const [done] = await port.orders();
    expect(done!.status).toBe("delivered");
    expect(done!.grants.every((g) => !g.active)).toBe(true);
    expect((await port.accessLog()).some((e) => e.action === "access.read")).toBe(true);
  });
});
