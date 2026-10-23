// P13 pelos handlers com o banco real: agendar gera confirmação e lembretes; sem canal vira "para compartilhar";
// com canal (P12 simulado) entra na fila do canal; remarcar troca os lembretes; cancelar para; orçamento parado
// gera follow-up e o aceite para; cobrança vencida gera lembrete e o pagamento para; SAIR cancela tudo; teto diário
// adia; reativação só como campanha com público visto; indicador de lembretes do P18 medido. SEC: outro dono.
import { afterAll, describe, expect, it } from "vitest";
import {
  AnalyticsMetricsOutput, BookingOutput, ChannelConnectionOutput, LifecycleAudienceOutput, LifecycleCampaignOutput, LifecycleSettingsOutput, LifecycleStepOutput,
  LifecycleStepsListOutput, ReceivableOutput, SalesQuoteOutput, SalesQuoteSendOutput, ScheduleSettings, SimInboundOutput, SimPhoneOutput,
} from "@contracts";
import { call, fails, FX, iso, nextWeek, ok, plusMin, pool, runDispatch, runJobs, sql, T, U } from "./harness.ts";

const owner = { as: U.ownerA, tenant: T.A };
const ANA = "+5511988887777";
/** Cliente nova só deste roteiro (o banco é compartilhado entre os arquivos): sem agendamentos nem canal. */
const MARINA = "30000000-0000-4000-8000-0000000000a9";
const BUSINESS = "+5511999990001";
afterAll(() => pool.end());

const steps = async (status: string | null = null) => ok(LifecycleStepsListOutput, "lifecycle", "lifecycle.steps", { ...owner, body: { status } });
const of = (list: Awaited<ReturnType<typeof steps>>, aggregateId: string) => list.steps.filter((s) => s.aggregate_id === aggregateId).map((s) => `${s.rule}:${s.step_key}=${s.status}`).sort();

describe("P13 · relacionamento pelos handlers", () => {
  let bookingAna = "";
  let bookingVersion = 1;

  it("1 · agendar gera confirmação agora e lembretes 24 h/2 h; sem canal a confirmação fica para compartilhar", async () => {
    await sql("insert into public.customers (id, tenant_id, name) values ($1, $2, 'Marina (exemplo)') on conflict do nothing", [MARINA, T.A]);
    const settings = await ok(ScheduleSettings, "scheduling", "schedule.settings", { ...owner, body: {} });
    await ok(ScheduleSettings, "scheduling", "schedule.rules_save", { ...owner, key: true, body: { resource_id: FX.resources.A, expected_version: settings.resource_version,
      rules: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, local_start: "08:00", local_end: "20:00" })) } });
    await sql("update public.customers set phone = $1 where id = $2", [ANA, FX.customers.abInA]);
    // O banco é compartilhado entre os arquivos: eventos antigos no outbox (ex.: o SAIR da Ana no roteiro do P12,
    // depois revertido pelo dono) são consumidos agora, antes de a régua desta jornada começar.
    await runJobs();
    const cfg = await ok(LifecycleSettingsOutput, "lifecycle", "lifecycle.settings_get", { ...owner, body: {} });
    expect(cfg.settings).toMatchObject({ enabled: true, reminder_hours: [24, 2], version: 0 });
    const t = await nextWeek(5, "18:00");
    const b = await ok(BookingOutput, "scheduling", "booking.create", { ...owner, key: true, body: {
      customer_id: FX.customers.abInA, guest_ref: null, service_id: FX.services.corteA, resource_id: FX.resources.A, slot: { starts_at: t, ends_at: plusMin(t, 30) }, quote_id: null, mode: "confirm" } });
    bookingAna = b.booking.id;
    bookingVersion = b.booking.version;
    const jobs = await runJobs();
    expect((jobs as { lifecycle?: { manual: number } }).lifecycle?.manual).toBeGreaterThanOrEqual(1);
    const list = await steps();
    expect(of(list, bookingAna)).toEqual(["confirmation:v1=manual", `reminder:v${bookingVersion}-h2=scheduled`, `reminder:v${bookingVersion}-h24=scheduled`].sort());
    const conf = list.steps.find((s) => s.aggregate_id === bookingAna && s.rule === "confirmation")!;
    expect(conf.body).toContain("Seu horário de Corte está confirmado para");
    expect(conf.customer_name).toBeTruthy();
    const reminder = list.steps.find((s) => s.aggregate_id === bookingAna && s.step_key.endsWith("-h24"))!;
    expect(reminder.due_at).toBe(iso(new Date(Date.parse(t) - 24 * 3_600_000)));
    // Compartilhar não é entregar; compartilhar de novo não é permitido.
    const shared = await ok(LifecycleStepOutput, "lifecycle", "lifecycle.step_mark_shared", { ...owner, key: true, body: { step_id: conf.id } });
    expect(shared.step.status).toBe("shared");
    await fails("lifecycle", "lifecycle.step_mark_shared", { ...owner, key: true, body: { step_id: conf.id } }, "POLICY_REJECTED", "status");
  });

  it("2 · remarcar troca os lembretes (antigos cancelados); cancelar o atendimento para tudo", async () => {
    const t2 = await nextWeek(5, "19:00");
    const r = await ok(BookingOutput, "scheduling", "booking.reschedule", { ...owner, key: true, body: { booking_id: bookingAna, expected_version: bookingVersion, slot: { starts_at: t2, ends_at: plusMin(t2, 30) }, quote_id: null } });
    await runJobs();
    let list = await steps();
    const mine = list.steps.filter((s) => s.aggregate_id === bookingAna);
    expect(mine.filter((s) => s.status === "cancelled" && s.skip_reason === "rescheduled")).toHaveLength(2);
    expect(mine.filter((s) => s.status === "shared")).toHaveLength(1); // o que já foi compartilhado não muda
    expect(mine.filter((s) => s.status === "scheduled").map((s) => s.due_at).sort()[0]).toBe(iso(new Date(Date.parse(t2) - 24 * 3_600_000)));
    expect(mine.filter((s) => s.status === "manual" && s.rule === "confirmation" && s.step_key === `v${r.booking.version}`)).toHaveLength(1);
    await ok(BookingOutput, "scheduling", "booking.cancel", { ...owner, key: true, body: { booking_id: bookingAna, expected_version: r.booking.version, reason: "Cliente desmarcou" } });
    await runJobs();
    list = await steps();
    expect(list.steps.filter((s) => s.aggregate_id === bookingAna && ["scheduled", "deferred", "manual"].includes(s.status))).toHaveLength(0);
    expect(list.steps.filter((s) => s.aggregate_id === bookingAna && s.skip_reason === "cancelled").length).toBeGreaterThanOrEqual(3);
  });

  it("3 · com canal conectado a confirmação entra na fila do P12 e o despacho entrega; teto diário adia; SAIR cancela", async () => {
    await ok(ChannelConnectionOutput, "messaging", "channel.connect", { ...owner, key: true, body: { provider: "simulated", phone_e164: BUSINESS } });
    await runDispatch();
    const code = /\b([0-9]{6})\b/.exec((await ok(SimPhoneOutput, "messaging", "sim.phone", { ...owner, body: { phone_e164: BUSINESS } })).messages.at(-1)!.body)![1]!;
    await ok(ChannelConnectionOutput, "messaging", "channel.verify", { ...owner, key: true, body: { code } });
    // A cliente escreve: nasce o contato com opt-in.
    await ok(SimInboundOutput, "messaging", "sim.inbound", { ...owner, key: true, body: { kind: "inbound", phone_e164: ANA, text: "Oi!" } });
    const t = await nextWeek(4, "18:00");
    const b = await ok(BookingOutput, "scheduling", "booking.create", { ...owner, key: true, body: {
      customer_id: FX.customers.abInA, guest_ref: null, service_id: FX.services.corteA, resource_id: FX.resources.A, slot: { starts_at: t, ends_at: plusMin(t, 30) }, quote_id: null, mode: "confirm" } });
    await runJobs();
    let list = await steps();
    const conf = list.steps.find((s) => s.aggregate_id === b.booking.id && s.rule === "confirmation")!;
    expect(conf.status).toBe("sent");
    expect(conf.message_status).toBe("queued");
    expect(await runDispatch()).toMatchObject({ sent: 1 });
    list = await steps();
    expect(list.steps.find((s) => s.id === conf.id)?.message_status).toBe("sent");
    expect((await ok(SimPhoneOutput, "messaging", "sim.phone", { ...owner, body: { phone_e164: ANA } })).messages.at(-1)?.body).toContain("está confirmado para");
    // Teto diário 1: já saiu 1 hoje → o próximo é adiado, não descartado.
    const cfg = await ok(LifecycleSettingsOutput, "lifecycle", "lifecycle.settings_save", { ...owner, key: true, body: { settings: { daily_budget: 1 }, expected_version: 0 } });
    expect(cfg.settings).toMatchObject({ daily_budget: 1, version: 1 });
    expect(cfg.sent_today).toBe(1);
    await fails("lifecycle", "lifecycle.settings_save", { ...owner, key: true, body: { settings: { daily_budget: 5 }, expected_version: 0 } }, "STALE_VERSION");
    const t3 = await nextWeek(4, "19:00");
    const b3 = await ok(BookingOutput, "scheduling", "booking.create", { ...owner, key: true, body: {
      customer_id: FX.customers.abInA, guest_ref: null, service_id: FX.services.corteA, resource_id: FX.resources.A, slot: { starts_at: t3, ends_at: plusMin(t3, 30) }, quote_id: null, mode: "confirm" } });
    await runJobs();
    list = await steps();
    expect(list.steps.find((s) => s.aggregate_id === b3.booking.id && s.rule === "confirmation")).toMatchObject({ status: "deferred", skip_reason: "daily_budget" });
    // SAIR pelo canal: tudo pendente da cliente cancelado; o que já saiu não muda.
    await ok(SimInboundOutput, "messaging", "sim.inbound", { ...owner, key: true, body: { kind: "inbound", phone_e164: ANA, text: "SAIR" } });
    await runJobs();
    list = await steps();
    expect(list.steps.filter((s) => s.customer_id === FX.customers.abInA && ["scheduled", "deferred", "manual"].includes(s.status))).toHaveLength(0);
    expect(list.steps.filter((s) => s.skip_reason === "opted_out").length).toBeGreaterThanOrEqual(5);
    expect(list.steps.find((s) => s.id === conf.id)?.status).toBe("sent");
    expect(list.counts.cancelled).toBeGreaterThanOrEqual(5);
  });

  it("4 · orçamento parado gera acompanhamento (não duplica); aceite pelo link para", async () => {
    const q = await ok(SalesQuoteOutput, "sales", "quote.create", { ...owner, key: true, body: {
      customer_id: MARINA, title: "Barba", valid_until: new Date(Date.now() + 10 * 86_400_000).toISOString(),
      items: [{ service_id: FX.services.barbaA, description: "Barba", quantity: 1, unit_price_cents: 4000 }] } });
    const sent = await ok(SalesQuoteSendOutput, "sales", "quote.send", { ...owner, key: true, body: { quote_id: q.quote.id, expected_version: 1 } });
    await runJobs();
    expect((await steps()).steps.filter((s) => s.aggregate_id === q.quote.id)).toHaveLength(0);
    await sql("update public.sales_quotes set sent_at = clock_timestamp() - interval '3 days' where id = $1", [q.quote.id]);
    await runJobs();
    await runJobs();
    const mine = (await steps()).steps.filter((s) => s.aggregate_id === q.quote.id);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ rule: "quote_followup", status: "manual" });
    expect(mine[0]!.body).toContain("R$ 40,00");
    const view = await call("sales", "quote.view", { as: null, body: { token: sent.token } });
    const v = view.data as { version_no: number; snapshot_hash: string };
    await call("sales", "quote.accept", { as: null, key: true, body: { token: sent.token, version_no: v.version_no, snapshot_hash: v.snapshot_hash } });
    await runJobs();
    expect((await steps()).steps.find((s) => s.aggregate_id === q.quote.id)).toMatchObject({ status: "cancelled", skip_reason: "accepted" });
  });

  it("5 · cobrança vencida gera lembrete; o pagamento para", async () => {
    const r = await ok(ReceivableOutput, "finance", "finance.create_receivable", { ...owner, key: true, body: { customer_id: MARINA, description: "Produto", amount_cents: 2500, due_at: iso(new Date(Date.now() - 2 * 86_400_000)) } });
    await runJobs();
    const step = (await steps()).steps.find((s) => s.aggregate_id === r.receivable.id)!;
    expect(step).toMatchObject({ rule: "receivable_reminder", status: "manual" });
    expect(step.body).toContain("R$ 25,00 (Produto)");
    await ok(ReceivableOutput.shape.receivable.partial().passthrough(), "finance", "finance.record_payment", { ...owner, key: true, body: { receivable_id: r.receivable.id, amount_cents: 2500, method: "cash", received_at: iso(new Date()) } });
    await runJobs();
    expect((await steps()).steps.find((s) => s.aggregate_id === r.receivable.id)).toMatchObject({ status: "cancelled", skip_reason: "paid" });
  });

  it("6 · reativação só como campanha: consentimento de marketing, público visto (hash) e teto", async () => {
    let aud = await ok(LifecycleAudienceOutput, "lifecycle", "lifecycle.audience", { ...owner, body: {} });
    expect(aud.customers).toEqual([]);
    expect(await ok(LifecycleStepOutput.shape.step.pick({}).passthrough(), "lifecycle", "lifecycle.consent_set", { ...owner, key: true, body: { customer_id: MARINA, purpose: "marketing", granted: true } })).toMatchObject({ granted: true });
    aud = await ok(LifecycleAudienceOutput, "lifecycle", "lifecycle.audience", { ...owner, body: {} });
    expect(aud.customers.map((c) => c.customer_id)).toEqual([MARINA]); // Marina: sem visita, com consentimento, sem canal
    await fails("lifecycle", "lifecycle.campaign_approve", { ...owner, key: true, body: { audience_hash: "0".repeat(64), max_sends: 5 } }, "STALE_VERSION", "audience_hash");
    const camp = await ok(LifecycleCampaignOutput, "lifecycle", "lifecycle.campaign_approve", { ...owner, key: true, body: { audience_hash: aud.audience_hash, max_sends: 5 } });
    expect(camp.campaign).toMatchObject({ audience_count: 1, scheduled: 1, status: "approved" });
    await runJobs();
    const step = (await steps("manual")).steps.find((s) => s.rule === "reactivation")!;
    expect(step.body).toContain("Responda SAIR");
    expect((await ok(LifecycleAudienceOutput, "lifecycle", "lifecycle.audience", { ...owner, body: {} })).customers).toEqual([]);
    const campaigns = await call("lifecycle", "lifecycle.campaigns", { ...owner, body: {} });
    expect((campaigns.data as { campaigns: { id: string; sent: number }[] }).campaigns[0]?.id).toBe(camp.campaign.id);
  });

  it("7 · P18: o indicador de lembretes agora é medido (enviado/compartilhado sobre atendimentos com cliente)", async () => {
    const from = await nextWeek(0, "00:00");
    const to = await nextWeek(6, "00:00");
    const m = await ok(AnalyticsMetricsOutput, "analytics", "analytics.metrics", { ...owner, body: { period: { starts_at: from, ends_at: to } } });
    const reminders = m.metrics.find((x) => x.key === "reminders")!;
    expect(reminders.status).toBe("ok");
    expect(reminders.denominator).toBeGreaterThanOrEqual(2); // ao menos os dois atendimentos confirmados da Ana (o cancelado fica fora; o banco é compartilhado)
    expect(reminders.numerator).toBe(0); // lembretes agendados ainda não saíram (24 h antes)
  });

  it("SEC · outro dono não vê, não configura nem aprova campanha", async () => {
    const other = { as: U.ownerB, tenant: T.A };
    await fails("lifecycle", "lifecycle.steps", { ...other, body: {} }, "FORBIDDEN");
    await fails("lifecycle", "lifecycle.settings_save", { ...other, key: true, body: { settings: { enabled: false }, expected_version: 1 } }, "FORBIDDEN");
    await fails("lifecycle", "lifecycle.campaign_approve", { ...other, key: true, body: { audience_hash: "a".repeat(64), max_sends: 1 } }, "FORBIDDEN");
    await fails("lifecycle", "lifecycle.consent_set", { ...other, key: true, body: { customer_id: FX.customers.abInA, purpose: "marketing", granted: true } }, "FORBIDDEN");
  });
});
