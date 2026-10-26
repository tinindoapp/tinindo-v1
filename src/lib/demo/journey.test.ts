// Jornada integrada da demonstração: o MESMO atendimento sai da Agenda, aparece no Caixa sem cobrança, é cobrado e recebido
// à mão (saldo muda só aí) e fica avaliável pela cliente. Concluir não cobra; repetir não duplica.
import { beforeEach, describe, expect, it } from "vitest";
import { FX } from "@contracts/fixtures.ts";
import { createDemoPort as createFinanceDemo } from "../../features/finance/demoPort.ts";
import { monthPeriod } from "../../features/finance/money.ts";
import { createDemoCustomerPort, resetDemoState as resetReviews } from "../../features/reputation/demoPort.ts";
import { customerBookingsFrom } from "../../features/scheduling/demoCustomerBookings.ts";
import { createFixturePort } from "../../features/scheduling/fixturePort.ts";
import { completedVisits, completionEventId, provideCustomerBookings, publishCompletedVisit, resetDemoJourney } from "./journey.ts";

const TZ = "America/Sao_Paulo";
const period = monthPeriod("2026-10", TZ);
const ANA_0900 = "60000000-0000-4000-8000-000000000001";
const key = () => crypto.randomUUID();

function demo() {
  const agenda = createFixturePort({
    onCompleted: (b) =>
      publishCompletedVisit({
        booking_id: b.id, customer_id: b.customer_id, service_id: b.service_id, starts_at: b.starts_at, ends_at: b.ends_at,
        agreed_price_cents: b.agreed_price_cents, completed_event_id: completionEventId(b.id),
      }),
  });
  // Como no app: "Minhas reservas" e a avaliação leem a mesma agenda.
  provideCustomerBookings((customerId) => customerBookingsFrom(agenda, customerId));
  return { agenda, caixa: createFinanceDemo({ visits: completedVisits }), cliente: createDemoCustomerPort() };
}

beforeEach(() => {
  resetDemoJourney();
  resetReviews();
});

describe("jornada integrada da demonstração", () => {
  it("agendado → concluído → sem cobrança → cobrado → recebido à mão → saldo", async () => {
    const { agenda, caixa, cliente } = demo();
    const before = await caixa.summary(period, TZ);
    expect((await caixa.uncharged(period)).map((b) => b.booking_id)).not.toContain(ANA_0900);

    const [ana] = (await agenda.listBookings({ starts_at: "2026-10-20T09:00:00-03:00", ends_at: "2026-10-20T09:30:00-03:00" }));
    expect(ana).toMatchObject({ id: ANA_0900, status: "confirmed" });
    const completeKey = key();
    await agenda.complete({ booking_id: ANA_0900, expected_version: ana!.version }, completeKey);
    // Clique duplo / nova tentativa com a mesma chave: mesmo resultado, um registro só.
    await agenda.complete({ booking_id: ANA_0900, expected_version: ana!.version }, completeKey);
    expect(completedVisits().filter((v) => v.booking_id === ANA_0900)).toHaveLength(1);

    // Concluir não recebe: aparece como sem cobrança, com o preço combinado e o pacote da Ana como opção.
    const uncharged = (await caixa.uncharged(period)).filter((b) => b.booking_id === ANA_0900);
    expect(uncharged).toHaveLength(1);
    expect(uncharged[0]).toMatchObject({ customer_id: FX.customers.abInA, agreed_price_cents: 6000 });
    expect(uncharged[0]!.package_ids).toHaveLength(1);
    expect(await caixa.summary(period, TZ)).toMatchObject({ received_cents: before.received_cents, receivable_open_cents: 0 });

    const r = await caixa.chargeBooking({ booking_id: ANA_0900 }, key());
    expect(r).toMatchObject({ booking_id: ANA_0900, amount_cents: 6000, paid_cents: 0, status: "open" });
    await expect(caixa.chargeBooking({ booking_id: ANA_0900 }, key())).rejects.toMatchObject({ code: "POLICY_REJECTED" });
    expect((await caixa.uncharged(period)).map((b) => b.booking_id)).not.toContain(ANA_0900);
    expect((await caixa.summary(period, TZ)).receivable_open_cents).toBe(6000);

    await caixa.recordPayment({ receivable_id: r.id, amount_cents: 6000, method: "pix", received_at: "2026-10-20T12:00:00Z" }, key());
    const after = await caixa.summary(period, TZ);
    expect(after.received_cents).toBe(before.received_cents + 6000);
    expect(after.receivable_open_cents).toBe(0);

    // A cliente pode avaliar o atendimento concluído (uma vez).
    const pend = await cliente.pending();
    expect(pend.pending.map((p) => p.booking_id)).toContain(ANA_0900);
    await cliente.submit(ANA_0900, 5, null, key());
    await expect(cliente.submit(ANA_0900, 4, null, key())).rejects.toMatchObject({ field: "already_reviewed" });
  });

  it("crédito de pacote no mesmo atendimento: debita uma vez e não vira cobrança nem recebimento", async () => {
    const { agenda, caixa } = demo();
    const [ana] = await agenda.listBookings({ starts_at: "2026-10-20T09:00:00-03:00", ends_at: "2026-10-20T09:30:00-03:00" });
    await agenda.complete({ booking_id: ANA_0900, expected_version: ana!.version }, key());
    const visit = (await caixa.uncharged(period)).find((b) => b.booking_id === ANA_0900)!;
    const before = await caixa.summary(period, TZ);
    const input = { package_id: visit.package_ids[0]!, booking_id: ANA_0900, event_id: visit.completed_event_id! };
    const b1 = await caixa.consumePackage(input, key());
    const b2 = await caixa.consumePackage(input, key());
    expect(b2.remaining_credits).toBe(b1.remaining_credits);
    expect((await caixa.uncharged(period)).map((b) => b.booking_id)).not.toContain(ANA_0900);
    await expect(caixa.chargeBooking({ booking_id: ANA_0900 }, key())).rejects.toMatchObject({ code: "POLICY_REJECTED" });
    expect((await caixa.summary(period, TZ)).received_cents).toBe(before.received_cents);
  });

  it("atendimento futuro não conclui e não chega ao Caixa; quem não é a cliente não avalia", async () => {
    const { agenda, caixa, cliente } = demo();
    const later = "60000000-0000-4000-8000-000000000006"; // 15:00, depois do relógio fixo (09:00)
    const [b] = await agenda.listBookings({ starts_at: "2026-10-20T15:00:00-03:00", ends_at: "2026-10-20T15:30:00-03:00" });
    await expect(agenda.complete({ booking_id: later, expected_version: b!.version }, key())).rejects.toMatchObject({ code: "POLICY_REJECTED" });
    expect((await caixa.uncharged(period)).map((x) => x.booking_id)).not.toContain(later);

    // Atendimento concluído de outro cliente (barba do Bruno, 19/10, na agenda) não aparece para a Ana avaliar.
    const bruno = "60000000-0000-4000-8000-000000000105";
    expect((await cliente.pending()).pending.map((p) => p.booking_id)).not.toContain(bruno);
    await expect(cliente.submit(bruno, 5, null, key())).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
