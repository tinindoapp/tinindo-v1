import { beforeEach, describe, expect, it } from "vitest";
import { advanceDemoClock, createDemoLinkPort, createDemoPort, resetDemoState } from "./demoPort.ts";

const code = (p: Promise<unknown>) => p.then(() => "ok", (e: { code: string; field?: string }) => `${e.code}/${e.field ?? "-"}`);
const tokenOf = (url: string | null) => /#t=([A-Za-z0-9_-]{43})$/.exec(url!)![1]!;

describe("demonstração de Pagamentos (mesmas regras do banco)", () => {
  beforeEach(() => resetDemoState());

  it("cobrança pelo saldo, uma viva por recebível, PSP real indisponível; o cliente paga e a baixa é única", async () => {
    const port = createDemoPort();
    const link = createDemoLinkPort();
    const [corte] = await port.openReceivables();
    expect(await code(port.createCharge(corte!.id, "psp", "p0"))).toBe("PROVIDER_UNAVAILABLE/-");
    const c = await port.createCharge(corte!.id, "simulated", "c1");
    expect(c.charge).toMatchObject({ status: "pending", amount_cents: 6000, simulated: true });
    expect((await port.createCharge(corte!.id, "simulated", "c1")).charge.id).toBe(c.charge.id);
    expect(await code(port.createCharge(corte!.id, "simulated", "c2"))).toBe("POLICY_REJECTED/charge");
    const t = tokenOf(c.pay_url);
    expect((await link.view(t)).status).toBe("pending");
    expect(await link.simPay(t, "paid", true)).toEqual({ status: "paid", applied: 1, duplicates: 0 });
    expect(await link.simPay(t, "paid", true)).toEqual({ status: "paid", applied: 0, duplicates: 0 });
    expect((await port.openReceivables()).some((r) => r.id === corte!.id)).toBe(false);
    const list = await port.charges();
    expect(list.charges[0]).toMatchObject({ status: "paid", settlement: "entry", paid_cents: 6000 });
    const f = await port.refund(c.charge.id, "desistiu", "r1");
    expect(f.status).toBe("done");
    expect((await port.openReceivables()).some((r) => r.id === corte!.id)).toBe(true);
    expect(await code(port.refund(c.charge.id, "de novo", "r2"))).toBe("POLICY_REJECTED/refund");
  });

  it("webhook perdido: conciliação lista; sync consulta e dá baixa; sem resposta = desconhecido; cancelar exige versão", async () => {
    const port = createDemoPort();
    const link = createDemoLinkPort();
    const [, barba, pomada] = await port.openReceivables();
    const c = await port.createCharge(barba!.id, "simulated", "c1");
    expect(await link.simPay(tokenOf(c.pay_url), "paid", false)).toEqual({ status: "pending", applied: 0, duplicates: 0 });
    const rec = await port.reconcile("simulated", "2026-10-20", "k1");
    expect(rec.differences).toEqual([expect.objectContaining({ kind: "paid_without_entry", charge_id: c.charge.id })]);
    expect(await port.sync!()).toMatchObject({ checked: 0 });
    advanceDemoClock(2 * 60 * 60_000);
    expect(await port.sync!()).toMatchObject({ checked: 1, settled: 1 });
    expect((await port.reconcile("simulated", "2026-10-20", "k2")).differences).toEqual([]);
    const u = await port.createCharge(pomada!.id, "simulated", "c2");
    expect(u.charge.status).toBe("unknown");
    expect((await port.charges()).unknown).toBe(1);
    expect(await port.sync!()).toMatchObject({ checked: 1, closed: 1 });
    const retry = await port.createCharge(pomada!.id, "simulated", "c3");
    expect(retry.charge.status).toBe("pending");
    expect(await code(port.cancelCharge({ ...retry.charge, version: 1 }, "x1"))).toBe("STALE_VERSION/-");
    expect((await port.cancelCharge(retry.charge, "x2")).status).toBe("cancelled");
    expect(await link.simPay(tokenOf(retry.pay_url), "paid", true)).toEqual({ status: "cancelled", applied: 0, duplicates: 0 });
  });
});
