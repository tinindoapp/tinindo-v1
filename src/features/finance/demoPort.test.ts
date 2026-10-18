import { describe, expect, it } from "vitest";
import { FX } from "@contracts/fixtures.ts";
import { createDemoPort } from "./demoPort.ts";
import { monthPeriod } from "./money.ts";

const period = monthPeriod("2026-10", "America/Sao_Paulo");
const K = (n: number) => `chave-caixa-${String(n).padStart(10, "0")}`;

describe("emulação do caixa (mesmas regras do banco)", () => {
  it("resumo separa recebido, gasto e a receber, com cobertura", async () => {
    const port = createDemoPort();
    const s = await port.summary(period, "America/Sao_Paulo");
    expect(s).toMatchObject({ received_cents: 26000, spent_cents: 1500, receivable_open_cents: 0, records_count: 3 });
    expect(s.coverage_note).toMatch(/Não é lucro/);
    expect(await port.uncharged(period)).toHaveLength(2);
  });

  it("cobrar e receber: parcial, excesso negado, quitado e estorno único", async () => {
    const port = createDemoPort();
    const [b] = await port.uncharged(period);
    const r = await port.chargeBooking({ booking_id: b!.booking_id }, K(1));
    expect(r).toMatchObject({ amount_cents: 6000, status: "open" });
    await expect(port.chargeBooking({ booking_id: b!.booking_id }, K(2))).rejects.toMatchObject({ code: "POLICY_REJECTED" });
    const p1 = await port.recordPayment({ receivable_id: r.id, amount_cents: 2500, method: "cash", received_at: "2026-10-20T11:00:00Z" }, K(3));
    expect(await port.recordPayment({ receivable_id: r.id, amount_cents: 2500, method: "cash", received_at: "2026-10-20T11:00:00Z" }, K(3))).toEqual(p1);
    await expect(port.recordPayment({ receivable_id: r.id, amount_cents: 4000, method: "pix", received_at: "2026-10-20T11:00:00Z" }, K(4)))
      .rejects.toMatchObject({ code: "POLICY_REJECTED", field: "amount_cents" });
    await port.recordPayment({ receivable_id: r.id, amount_cents: 3500, method: "pix", received_at: "2026-10-20T11:00:00Z" }, K(5));
    await port.reversePayment({ payment_id: p1.id, reason: "Devolvido" }, K(6));
    await expect(port.reversePayment({ payment_id: p1.id, reason: "De novo" }, K(7))).rejects.toMatchObject({ code: "POLICY_REJECTED" });
    const s = await port.summary(period, "America/Sao_Paulo");
    expect(s.received_cents).toBe(26000 + 3500);
    expect(s.receivable_open_cents).toBe(2500);
  });

  it("crédito de pacote: debita uma vez por evento, não gera caixa e bloqueia cobrança do mesmo atendimento", async () => {
    const port = createDemoPort();
    const before = await port.summary(period, "America/Sao_Paulo");
    const ana = (await port.uncharged(period)).find((b) => b.customer_id === FX.customers.abInA)!;
    expect(ana.package_ids).toHaveLength(1);
    const input = { package_id: ana.package_ids[0]!, booking_id: ana.booking_id, event_id: ana.completed_event_id! };
    expect((await port.consumePackage(input, K(1))).remaining_credits).toBe(3);
    expect((await port.consumePackage(input, K(2))).remaining_credits).toBe(3);
    await expect(port.chargeBooking({ booking_id: ana.booking_id }, K(3))).rejects.toMatchObject({ field: "package" });
    expect((await port.summary(period, "America/Sao_Paulo")).received_cents).toBe(before.received_cents);
    const [pkg] = await port.packages();
    await port.reversePackage({ entry_id: pkg!.entries[0]!.id, reason: "Desmarcou" }, K(4));
    expect((await port.packages())[0]!.remaining_credits).toBe(4);
  });

  it("venda de pacote gera um único valor a receber", async () => {
    const port = createDemoPort();
    await port.sellPackage({ customer_id: FX.customers.guestInA, service_id: FX.services.barbaA, credits: 10, total_price_cents: 30000 }, K(1));
    await port.sellPackage({ customer_id: FX.customers.guestInA, service_id: FX.services.barbaA, credits: 10, total_price_cents: 30000 }, K(1));
    expect((await port.summary(period, "America/Sao_Paulo")).receivable_open_cents).toBe(30000);
    expect((await port.packages()).filter((p) => p.purchased_credits === 10)).toHaveLength(1);
  });
});
