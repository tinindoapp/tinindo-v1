// Fase 2 pelos handlers com o banco real: orçamento aceito pelo link vira reserva; assistente propõe, o dono aprova e
// executa (P08); plano e serviço assistido com acesso delegado (P15); indicadores com denominador e baseline (P18).
// Também confere que TODA operação do registro v1 chega a algum handler (rota existente ≠ 404).
import { afterAll, describe, expect, it } from "vitest";
import {
  ActionApproval, ActionReceipt, AgentAnswer, AnalyticsBaselineOutput, AnalyticsMetricsOutput, OPERATION_NAMES, OPERATIONS, OpsQueueOutput,
  OpsSnapshotOutput, OrderOutput, PlanCurrentOutput, SalesQuoteDecideOutput, SalesQuoteOutput, SalesQuotePublicView, SalesQuoteSendOutput,
  ScheduleSettings,
} from "@contracts";
import { call, fails, FX, nextWeek, ok, pool, sql, T, U } from "./harness.ts";

const owner = { as: U.ownerA, tenant: T.A };
afterAll(() => pool.end());

describe("registro v1 ↔ handlers", () => {
  it("toda operação registrada tem rota viva no handler do seu módulo (método errado dá 'Use X.', não 404 de rota)", async () => {
    const crmPath: Record<string, string> = { "customer.list": "customers", "service.list": "services" };
    const getOps = new Set(["customer.list", "service.list", "profile.get", "public.profile", "referral.list"]);
    for (const name of OPERATION_NAMES) {
      const spec = OPERATIONS[name];
      const isGet = getOps.has(name);
      // Sonda: o método contrário ao da rota. Rota inexistente responderia NOT_FOUND antes de olhar o método.
      const r = await call(spec.module, crmPath[name] ?? name, { as: U.ownerA, tenant: T.A, method: isGet ? "POST" : "GET", body: isGet ? {} : undefined });
      expect(r.error?.code, name).toBe("VALIDATION_ERROR");
      expect(r.error?.message, name).toBe(isGet ? "Use GET." : "Use POST.");
    }
  });
});

describe("P11 → P08 → P15 → P18", () => {
  let orderId = "";

  it("orçamento com horário: o aceite pelo link reserva; a versão antiga não é aceita", async () => {
    const settings = await ok(ScheduleSettings, "scheduling", "schedule.settings", { ...owner, body: {} });
    await ok(ScheduleSettings, "scheduling", "schedule.rules_save", { ...owner, key: true, body: { resource_id: settings.resource_id, expected_version: settings.resource_version,
      rules: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, local_start: "09:00", local_end: "19:00" })) } });
    const tue15 = await nextWeek(2, "15:00");
    const q = await ok(SalesQuoteOutput, "sales", "quote.create", { ...owner, key: true, body: {
      customer_id: FX.customers.abInA, title: "Corte e barba", valid_until: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      items: [{ service_id: FX.services.corteA, description: "Corte", quantity: 1, unit_price_cents: 6000 }, { service_id: FX.services.barbaA, description: "Barba", quantity: 1, unit_price_cents: 4000 }],
      slot: { service_id: FX.services.corteA, starts_at: tue15 } } });
    expect(q.quote.current.total_cents).toBe(10000);
    const sent = await ok(SalesQuoteSendOutput, "sales", "quote.send", { ...owner, key: true, body: { quote_id: q.quote.id, expected_version: 1 } });
    const v1 = await ok(SalesQuotePublicView, "sales", "quote.view", { as: null, body: { token: sent.token } });
    const revised = await ok(SalesQuoteOutput, "sales", "quote.revise", { ...owner, key: true, body: {
      quote_id: q.quote.id, expected_version: 1, title: "Corte e barba", valid_until: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      items: [{ service_id: FX.services.corteA, description: "Corte", quantity: 1, unit_price_cents: 6000 }, { service_id: FX.services.barbaA, description: "Barba", quantity: 1, unit_price_cents: 3500 }],
      slot: { service_id: FX.services.corteA, starts_at: tue15 } } });
    expect(revised.quote.current.version_no).toBe(2);
    await fails("sales", "quote.accept", { as: null, key: true, body: { token: sent.token, version_no: v1.version_no, snapshot_hash: v1.snapshot_hash } }, "STALE_VERSION");
    const v2 = await ok(SalesQuotePublicView, "sales", "quote.view", { as: null, body: { token: sent.token } });
    const accepted = await ok(SalesQuoteDecideOutput, "sales", "quote.accept", { as: null, key: true, body: { token: sent.token, version_no: 2, snapshot_hash: v2.snapshot_hash } });
    expect(accepted.booking?.status).toBe("confirmed");
    expect(accepted.booking?.agreed_price_cents).toBe(9500);
    expect(accepted.booking?.source).toBe("quote");
    // Aceito não é pago.
    expect((await sql<{ n: number }>("select count(*)::int as n from public.receivables where booking_id = $1", [accepted.booking!.id]))[0]!.n).toBe(0);
  });

  it("assistente propõe um agendamento; aprovar ≠ executar; executar cria a reserva uma vez", async () => {
    const answer = await ok(AgentAnswer, "agent", "agent.ask", { ...owner, key: true, body: { text: "agende um corte para Cliente AB na quarta às 11h" } });
    expect(answer.state).toBe("pending_approval");
    expect(answer.proposal?.tool).toBe("booking.create");
    const p = answer.proposal!;
    expect((await sql<{ n: number }>("select count(*)::int as n from public.bookings where source = 'agent'"))[0]!.n).toBe(0);
    const approval = await ok(ActionApproval, "agent", "action.approve", { ...owner, key: true, body: { proposal_id: p.proposal_id, payload_hash: p.payload_hash, expected_version: p.version } });
    expect((await sql<{ n: number }>("select count(*)::int as n from public.bookings where source = 'agent'"))[0]!.n).toBe(0);
    const key = `executar-${approval.approval_id.replace(/-/g, "")}`;
    const receipt = await ok(ActionReceipt, "agent", "action.execute", { ...owner, key, body: { approval_id: approval.approval_id } });
    expect(receipt.status).toBe("executed");
    const again = await ok(ActionReceipt, "agent", "action.execute", { ...owner, key, body: { approval_id: approval.approval_id } });
    expect(again.result_ref).toEqual(receipt.result_ref);
    expect((await sql<{ n: number }>("select count(*)::int as n from public.bookings where source = 'agent'"))[0]!.n).toBe(1);
    // Segunda aprovação da mesma proposta: já usada.
    await fails("agent", "action.approve", { ...owner, key: true, body: { proposal_id: p.proposal_id, payload_hash: p.payload_hash, expected_version: p.version } }, "STALE_VERSION");
  });

  it("plano com versão fixada e pedido assistido: operador só lê com acesso concedido, e a leitura fica registrada", async () => {
    const plan = await ok(PlanCurrentOutput, "service-ops", "plan.current", { ...owner, body: {} });
    const founder = plan.catalog.find((c) => c.code === "founder")!;
    const sub = await ok(PlanCurrentOutput, "service-ops", "plan.subscribe", { ...owner, key: true, body: { offering_version_id: founder.id, scope_hash: founder.scope_hash } });
    expect(sub.subscription?.price_cents).toBe(7900);
    expect(sub.usage?.agent_questions_limit).toBe(founder.agent_questions_month);
    const svc = plan.catalog.find((c) => c.kind === "service")!;
    const order = await ok(OrderOutput, "service-ops", "order.request", { ...owner, key: true, body: { offering_version_id: svc.id, scope_hash: svc.scope_hash, notes: null } });
    orderId = order.order.id;
    // Operadora cadastrada pelo backend (nunca por RPC): um login próprio, para não confundir com o usuário sem vínculo.
    const OPERATOR = "e0000000-0000-4000-8000-0000000000e1";
    await sql("insert into public.platform_operators (user_id, display_name) values ($1, 'Operadora (exemplo)') on conflict do nothing", [OPERATOR]);
    const op = { as: OPERATOR };
    const queue = await ok(OpsQueueOutput, "service-ops", "ops.queue", { ...op, body: {} });
    expect(queue.orders.map((o) => o.id)).toContain(orderId);
    expect(JSON.stringify(queue)).not.toMatch(/Cliente AB|@exemplo\.test/);
    await ok(OrderOutput, "service-ops", "ops.assign", { ...op, tenant: T.A, key: true, body: { order_id: orderId, assignee_user_id: OPERATOR } });
    await fails("service-ops", "ops.snapshot", { ...op, tenant: T.A, body: { order_id: orderId } }, "FORBIDDEN");
    await fails("service-ops", "ops.start", { ...op, tenant: T.A, key: true, body: { order_id: orderId } }, "POLICY_REJECTED", "access");
    await ok((await import("@contracts")).AccessGrantOutput, "service-ops", "access.grant", { ...owner, key: true, body: {
      order_id: orderId, scopes: ["catalog"], expires_at: new Date(Date.now() + 2 * 86_400_000).toISOString(), justification: "Cadastro de serviços" } });
    const snap = await ok(OpsSnapshotOutput, "service-ops", "ops.snapshot", { ...op, tenant: T.A, body: { order_id: orderId } });
    expect(snap.catalog?.length).toBeGreaterThan(0);
    expect(snap.customers).toBeNull();
    const log = await ok((await import("@contracts")).AccessLogOutput, "service-ops", "access.log", { ...owner, body: {} });
    expect(log.entries.some((e) => e.action === "access.read" && e.actor_name === "Operadora (exemplo)")).toBe(true);
    await ok(OrderOutput, "service-ops", "ops.start", { ...op, tenant: T.A, key: true, body: { order_id: orderId } });
    await fails("service-ops", "ops.log_work", { ...op, tenant: T.A, key: true, body: { order_id: orderId, minutes: 480, kind: "human" } }, "QUOTA_EXCEEDED");
    await ok((await import("@contracts")).OpsLogWorkOutput, "service-ops", "ops.log_work", { ...op, tenant: T.A, key: true, body: { order_id: orderId, minutes: 45, kind: "human" } });
  });

  it("indicadores: denominador explícito, lembretes indisponíveis, baseline congelada, sem causalidade", async () => {
    const period = { starts_at: new Date(Date.now() - 28 * 86_400_000).toISOString(), ends_at: new Date(Date.now() + 14 * 86_400_000).toISOString() };
    const m = await ok(AnalyticsMetricsOutput, "analytics", "analytics.metrics", { ...owner, body: { period } });
    expect(m.causality).toBe("not_established");
    expect(m.metrics.find((x) => x.key === "reminders")?.status).not.toBe("unavailable"); // P13 mede: enviado/compartilhado sobre atendimentos
    expect(m.metrics.find((x) => x.key === "human_minutes")?.value).toBe(45);
    const occ = m.metrics.find((x) => x.key === "occupancy")!;
    expect(occ.denominator).toBeGreaterThan(0);
    expect(m.coverage.some((c) => c.key === "future")).toBe(true);
    await fails("analytics", "analytics.baseline_create", { ...owner, key: true, body: { label: "Futuro", period } }, "VALIDATION_ERROR", "period");
    const closed = { starts_at: period.starts_at, ends_at: new Date(Date.now() - 86_400_000).toISOString() };
    const b = await ok(AnalyticsBaselineOutput, "analytics", "analytics.baseline_create", { ...owner, key: true, body: { label: "Antes", period: closed } });
    const cmp = await ok(AnalyticsMetricsOutput, "analytics", "analytics.metrics", { ...owner, body: { period, baseline_id: b.baseline.id } });
    expect(cmp.comparison?.length).toBe(m.metrics.length);
    expect(cmp.comparison_note).toMatch(/não prova/);
  });
});
