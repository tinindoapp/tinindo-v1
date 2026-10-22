// UAT · Personal (docs/10) pelos handlers com o banco real, no negócio B: vende pacote de 10 sessões e registra o
// pagamento uma vez; agenda recorrência de oito semanas com uma data em conflito e resolve; conclui duas sessões
// e o saldo fica em 8; cancela a terceira sem lançar o caixa de novo. Sem dados de saúde em lugar nenhum.
import { afterAll, describe, expect, it } from "vitest";
import {
  BookingCreateSeriesOutput, BookingOutput, FinanceLedgerOutput, FinanceUnchargedOutput, PackageBalance, PackageListOutput,
  PackageSellOutput, PaymentEntry, ScheduleSettings,
} from "@contracts";
import { fails, FX, nextWeek, ok, plusMin, pool, sql, T, U } from "./harness.ts";

const owner = { as: U.ownerB, tenant: T.B };
const period = { starts_at: new Date(Date.now() - 30 * 86_400_000).toISOString(), ends_at: new Date(Date.now() + 90 * 86_400_000).toISOString() };
afterAll(() => pool.end());

describe("UAT personal", () => {
  let pkg = { id: "", receivable: "" };
  let series: { created: { id: string; version: number; starts_at: string }[] } = { created: [] };

  it("1 · vende pacote de 10 sessões por R$1.000 e registra o pagamento uma vez", async () => {
    const sold = await ok(PackageSellOutput, "finance", "package.sell", { ...owner, key: true, body: {
      customer_id: FX.customers.abInB, service_id: FX.services.sessaoB, credits: 10, total_price_cents: 100000 } });
    expect(sold.package.remaining_credits).toBe(10);
    expect(sold.receivable.amount_cents).toBe(100000);
    pkg = { id: sold.package.package_id, receivable: sold.receivable.id };
    const key = "pagamento-pacote-personal-0001";
    const body = { receivable_id: pkg.receivable, amount_cents: 100000, method: "transfer", received_at: new Date().toISOString() };
    const paid = await ok(PaymentEntry, "finance", "finance.record_payment", { ...owner, key, body });
    expect((await ok(PaymentEntry, "finance", "finance.record_payment", { ...owner, key, body })).id).toBe(paid.id);
    const ledger = await ok(FinanceLedgerOutput, "finance", "finance.ledger", { ...owner, body: { period } });
    expect(ledger.payments).toHaveLength(1);
    expect(ledger.receivables.find((r) => r.id === pkg.receivable)?.status).toBe("paid");
  });

  it("2 · recorrência de oito semanas com uma data em conflito: cria sete, aponta a oitava, e o dono resolve", async () => {
    const settings = await ok(ScheduleSettings, "scheduling", "schedule.settings", { ...owner, body: {} });
    await ok(ScheduleSettings, "scheduling", "schedule.rules_save", { ...owner, key: true, body: { resource_id: settings.resource_id, expected_version: settings.resource_version,
      rules: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, local_start: "06:00", local_end: "21:00" })) } });
    const mon7 = await nextWeek(1, "07:00");
    // Conflito na 3ª semana: outro aluno já tem a segunda 07:00.
    const week3 = plusMin(mon7, 14 * 24 * 60);
    await ok(BookingOutput, "scheduling", "booking.create", { ...owner, key: true, body: {
      customer_id: null, guest_ref: "Aluno visitante", service_id: FX.services.sessaoB, resource_id: settings.resource_id,
      slot: { starts_at: week3, ends_at: plusMin(week3, 60) }, quote_id: null, mode: "confirm" } });
    // Tudo ou nada: um conflito desfaz tudo.
    await fails("scheduling", "booking.create_series", { ...owner, key: true, body: {
      customer_id: FX.customers.abInB, guest_ref: null, service_id: FX.services.sessaoB, resource_id: settings.resource_id,
      slot: { starts_at: mon7, ends_at: plusMin(mon7, 60) }, weeks: 8, all_or_nothing: true } }, "SLOT_CONFLICT");
    expect((await sql<{ n: number }>("select count(*)::int as n from public.bookings where customer_id = $1", [FX.customers.abInB]))[0]!.n).toBe(0);
    const r = await ok(BookingCreateSeriesOutput, "scheduling", "booking.create_series", { ...owner, key: true, body: {
      customer_id: FX.customers.abInB, guest_ref: null, service_id: FX.services.sessaoB, resource_id: settings.resource_id,
      slot: { starts_at: mon7, ends_at: plusMin(mon7, 60) }, weeks: 8, all_or_nothing: false } });
    expect(r.created).toHaveLength(7);
    expect(r.conflicts).toEqual([{ starts_at: week3, ends_at: plusMin(week3, 60) }]);
    series = { created: r.created };
    // Resolve a data em conflito: mesma semana, 08:30.
    const alt = plusMin(week3, 90);
    const fixed = await ok(BookingOutput, "scheduling", "booking.create", { ...owner, key: true, body: {
      customer_id: FX.customers.abInB, guest_ref: null, service_id: FX.services.sessaoB, resource_id: settings.resource_id,
      slot: { starts_at: alt, ends_at: plusMin(alt, 60) }, quote_id: null, mode: "confirm" } });
    expect(fixed.booking.status).toBe("confirmed");
  });

  it("3 · conclui duas sessões: cada uma debita um crédito uma vez; saldo 8; nada entra no caixa", async () => {
    // Duas sessões já ocorridas (dados de cenário), concluídas pela agenda.
    const past = await sql<{ id: string }>(`
      insert into public.bookings (tenant_id, resource_id, customer_id, service_id, starts_at, ends_at, occupied_range, blocks_capacity, status, agreed_price_cents, source)
      select $1, $2, $3, $4, now() - make_interval(days => g), now() - make_interval(days => g) + interval '60 minutes',
        tstzrange(now() - make_interval(days => g) - interval '15 minutes', now() - make_interval(days => g) + interval '75 minutes', '[)'), true, 'confirmed', 12000, 'owner'
      from generate_series(1, 2) g returning id`, [T.B, FX.resources.B, FX.customers.abInB, FX.services.sessaoB]);
    for (const { id } of past) {
      await ok(BookingOutput, "scheduling", "booking.complete", { ...owner, key: true, body: { booking_id: id, expected_version: 1 } });
    }
    const uncharged = await ok(FinanceUnchargedOutput, "finance", "finance.uncharged", { ...owner, body: { period } });
    expect(uncharged.bookings).toHaveLength(2);
    for (const b of uncharged.bookings) {
      expect(b.package_ids).toContain(pkg.id);
      const key = `consumo-${b.booking_id.slice(0, 8)}`;
      const body = { package_id: pkg.id, booking_id: b.booking_id, event_id: b.completed_event_id! };
      const first = await ok(PackageBalance, "finance", "package.consume", { ...owner, key, body });
      // Retry com a mesma chave e tentativa com outra chave para o MESMO evento: um débito só.
      expect((await ok(PackageBalance, "finance", "package.consume", { ...owner, key, body })).remaining_credits).toBe(first.remaining_credits);
      expect((await ok(PackageBalance, "finance", "package.consume", { ...owner, key: true, body })).remaining_credits).toBe(first.remaining_credits);
    }
    const list = await ok(PackageListOutput, "finance", "package.list", { ...owner, body: {} });
    expect(list.packages.find((p) => p.package_id === pkg.id)?.remaining_credits).toBe(8);
    // Cobrar um atendimento pago com crédito seria receita repetida.
    await fails("finance", "finance.charge_booking", { ...owner, key: true, body: { booking_id: past[0]!.id, due_at: null } }, "POLICY_REJECTED", "package");
    expect((await ok(FinanceUnchargedOutput, "finance", "finance.uncharged", { ...owner, body: { period } })).bookings).toHaveLength(0);
  });

  it("4 · cancela a terceira sessão da série: nada muda no caixa nem no saldo", async () => {
    const third = series.created[2]!;
    const cancelled = await ok(BookingOutput, "scheduling", "booking.cancel", { ...owner, key: true, body: { booking_id: third.id, expected_version: third.version, reason: "Viagem" } });
    expect(cancelled.booking.status).toBe("cancelled");
    const ledger = await ok(FinanceLedgerOutput, "finance", "finance.ledger", { ...owner, body: { period } });
    expect(ledger.payments.filter((p) => !p.reversal_of)).toHaveLength(1);
    const list = await ok(PackageListOutput, "finance", "package.list", { ...owner, body: {} });
    expect(list.packages.find((p) => p.package_id === pkg.id)?.remaining_credits).toBe(8);
    // As outras seis continuam confirmadas.
    const rest = await sql<{ n: number }>("select count(*)::int as n from public.bookings where series_id = (select series_id from public.bookings where id = $1) and status = 'confirmed'", [third.id]);
    expect(rest[0]!.n).toBe(6);
  });

  it("sem dados de saúde: nenhuma coluna de diagnóstico, lesão ou medida corporal no banco", async () => {
    const cols = await sql<{ c: string }>(`select table_name || '.' || column_name as c from information_schema.columns
      where table_schema = 'public' and column_name ~* 'health|saude|lesao|injury|peso|weight|imc|bmi|diagnos|medical'`);
    expect(cols).toEqual([]);
  });
});
