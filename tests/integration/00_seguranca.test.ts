// SEC-01/02/03 (docs/10) de ponta a ponta: cada Edge Function com o banco real. O header de negócio é seleção;
// quem decide é o banco. Nenhuma resposta de negação carrega PII, e trocar o header não dá acesso.
import { afterAll, describe, expect, it } from "vitest";
import { ContextResponse, CustomerListOutput, FinanceSummaryOutput, PlanCurrentOutput, SalesQuoteListOutput, ScheduleSettings, WaitlistListOutput } from "@contracts";
import { call, fails, FX, ok, pool, T, U } from "./harness.ts";

const PII = ["cliente.ab@exemplo.test", "Cliente AB", "Visitante sem login", "Personal Exemplo B", "Barbearia Exemplo A"];
const period = { starts_at: "2026-10-01T03:00:00Z", ends_at: "2026-10-31T03:00:00Z" };
const fin = { period, timezone: "America/Sao_Paulo" };

afterAll(() => pool.end());

describe("SEC-01 · dono de A não lê nem escreve no negócio B (header é seleção)", () => {
  const asA = { as: U.ownerA, tenant: T.B };

  it("contexto: membro de A pedindo B recebe 403 sem revelar se B existe", async () => {
    await fails("context", "", { ...asA, method: "GET" }, "FORBIDDEN");
    // Tenant inexistente dá o mesmo erro.
    await fails("context", "", { as: U.ownerA, tenant: "10000000-0000-4000-8000-0000000000ff", method: "GET" }, "FORBIDDEN");
  });

  it("leituras de todos os módulos negam", async () => {
    await fails("crm", "customers", { ...asA, method: "GET" }, "FORBIDDEN");
    await fails("scheduling", "schedule.settings", { ...asA, body: {} }, "FORBIDDEN");
    await fails("pricing", "pricing.list_rules", { ...asA, body: {} }, "FORBIDDEN");
    await fails("waitlist", "waitlist.list", { ...asA, body: {} }, "FORBIDDEN");
    await fails("finance", "finance.summary", { ...asA, body: fin }, "FORBIDDEN");
    await fails("sales", "quote.list", { ...asA, body: {} }, "FORBIDDEN");
    await fails("service-ops", "plan.current", { ...asA, body: {} }, "FORBIDDEN");
    await fails("analytics", "analytics.metrics", { ...asA, body: { period } }, "FORBIDDEN");
    await fails("network", "profile.get", { ...asA, method: "GET" }, "FORBIDDEN");
    await fails("agent", "agent.ask", { ...asA, body: { text: "o que tenho amanhã?" } }, "FORBIDDEN");
  });

  it("escritas de todos os módulos negam antes de qualquer efeito", async () => {
    const before = await pool.query("select (select count(*) from public.customers) + (select count(*) from public.bookings) + (select count(*) from public.receivables) as n");
    await fails("crm", "customer.upsert", { ...asA, key: true, body: { name: "Intruso" } }, "FORBIDDEN");
    await fails("crm", "service.save", { ...asA, key: true, body: { name: "X", duration_min: 30, base_price_cents: 100, min_price_cents: 100 } }, "FORBIDDEN");
    await fails("scheduling", "booking.create", { ...asA, key: true, body: {
      customer_id: null, guest_ref: "x", service_id: FX.services.sessaoB, resource_id: FX.resources.B,
      slot: { starts_at: "2026-11-03T13:00:00Z", ends_at: "2026-11-03T14:00:00Z" }, quote_id: null, mode: "confirm" } }, "FORBIDDEN");
    await fails("finance", "finance.create_receivable", { ...asA, key: true, body: { customer_id: null, description: "x", amount_cents: 100, due_at: null } }, "FORBIDDEN");
    await fails("sales", "quote.create", { ...asA, key: true, body: { customer_id: FX.customers.abInB, title: "x", valid_until: "2026-11-30T03:00:00Z",
      items: [{ description: "x", quantity: 1, unit_price_cents: 100 }] } }, "FORBIDDEN");
    await fails("identity", "onboarding.save", { ...asA, key: true, body: { expected_version: 1 } }, "FORBIDDEN");
    const after = await pool.query("select (select count(*) from public.customers) + (select count(*) from public.bookings) + (select count(*) from public.receivables) as n");
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  it("IDs de B enviados sob o tenant A não são encontrados (nem vazam existência)", async () => {
    const asOwnA = { as: U.ownerA, tenant: T.A };
    await fails("scheduling", "booking.create", { ...asOwnA, key: true, body: {
      customer_id: FX.customers.abInB, guest_ref: null, service_id: FX.services.corteA, resource_id: FX.resources.A,
      slot: { starts_at: "2026-11-03T13:00:00Z", ends_at: "2026-11-03T13:30:00Z" }, quote_id: null, mode: "confirm" } }, "NOT_FOUND", "customer_id");
    await fails("sales", "quote.create", { ...asOwnA, key: true, body: { customer_id: FX.customers.abInB, title: "x", valid_until: "2026-11-30T03:00:00Z",
      items: [{ description: "x", quantity: 1, unit_price_cents: 100 }] } }, "NOT_FOUND", "customer_id");
    await fails("finance", "finance.create_receivable", { ...asOwnA, key: true, body: { customer_id: FX.customers.abInB, description: "x", amount_cents: 100, due_at: null } }, "NOT_FOUND", "customer_id");
  });

  it("respostas de negação não carregam PII", async () => {
    for (const [m, op, o] of [["crm", "customers", { ...asA, method: "GET" as const }], ["finance", "finance.summary", { ...asA, body: fin }]] as const) {
      const r = await call(m, op, o);
      const text = JSON.stringify(r);
      for (const marker of PII) expect(text).not.toContain(marker);
    }
  });
});

describe("SEC-02 · cliente com login vê só o que lhe é explicitamente permitido", () => {
  const asCustomer = { as: U.customerAB, tenant: T.A };

  it("não é membro: contexto, CRM, caixa, agenda do dono, orçamentos e indicadores negam", async () => {
    await fails("context", "", { ...asCustomer, method: "GET" }, "FORBIDDEN");
    await fails("crm", "customers", { ...asCustomer, method: "GET" }, "FORBIDDEN");
    await fails("finance", "finance.summary", { ...asCustomer, body: fin }, "FORBIDDEN");
    await fails("scheduling", "booking.list", { ...asCustomer, body: { window: period } }, "FORBIDDEN");
    await fails("sales", "quote.list", { ...asCustomer, body: {} }, "FORBIDDEN");
    await fails("analytics", "analytics.metrics", { ...asCustomer, body: { period } }, "FORBIDDEN");
    await fails("agent", "agent.ask", { ...asCustomer, body: { text: "quanto recebi?" } }, "FORBIDDEN");
  });

  it("usuário sem vínculo nenhum também é negado em tudo", async () => {
    const outsider = { as: U.outsider, tenant: T.A };
    await fails("context", "", { ...outsider, method: "GET" }, "FORBIDDEN");
    await fails("scheduling", "schedule.settings", { ...outsider, body: {} }, "FORBIDDEN");
    await fails("service-ops", "ops.queue", { as: U.outsider, body: {} }, "FORBIDDEN");
  });
});

describe("SEC-03 · RPC privilegiada, anônimo e worker", () => {
  it("sem JWT: 401 antes de tocar o banco; anônimo só nas rotas públicas", async () => {
    await fails("crm", "customers", { as: null, tenant: T.A, method: "GET" }, "AUTH_REQUIRED");
    await fails("finance", "finance.summary", { as: null, tenant: T.A, body: fin }, "AUTH_REQUIRED");
    // Rota pública com token inexistente: 404 sem distinguir de malformado.
    await fails("sales", "quote.view", { as: null, body: { token: "a".repeat(43) } }, "NOT_FOUND");
    await fails("waitlist", "waitlist.offer_view", { as: null, body: { token: "a".repeat(43) } }, "NOT_FOUND");
    await fails("network", "public.profile", { as: null, method: "GET", query: { slug: "nao-existe" } }, "NOT_FOUND");
  });

  it("worker: segredo errado não roda; jobs_run só com o papel do worker", async () => {
    const { handlers } = await import("./harness.ts");
    const res = await handlers.jobs!(new Request("http://edge/functions/v1/jobs", { method: "POST", headers: { "X-Tinindo-Jobs-Secret": "x".repeat(40) } }));
    expect(res.status).toBe(401);
    const asOwner = await pool.connect();
    try {
      await asOwner.query("begin");
      await asOwner.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: U.ownerA, role: "authenticated" })]);
      await asOwner.query("set local role authenticated");
      await expect(asOwner.query("select public.jobs_run(10)")).rejects.toMatchObject({ code: "42501" });
      await asOwner.query("rollback");
    } finally {
      asOwner.release();
    }
  });

  it("o dono de A tem acesso normal ao próprio negócio (controle positivo)", async () => {
    const ctx = await ok(ContextResponse, "context", "", { as: U.ownerA, tenant: T.A, method: "GET" });
    expect(ctx.role).toBe("owner");
    const customers = await ok(CustomerListOutput, "crm", "customers", { as: U.ownerA, tenant: T.A, method: "GET" });
    expect(customers.items.map((c) => c.id)).toContain(FX.customers.abInA);
    expect(customers.items.map((c) => c.id)).not.toContain(FX.customers.abInB);
    await ok(ScheduleSettings, "scheduling", "schedule.settings", { as: U.ownerA, tenant: T.A, body: {} });
    await ok(WaitlistListOutput, "waitlist", "waitlist.list", { as: U.ownerA, tenant: T.A, body: {} });
    await ok(FinanceSummaryOutput, "finance", "finance.summary", { as: U.ownerA, tenant: T.A, body: fin });
    await ok(SalesQuoteListOutput, "sales", "quote.list", { as: U.ownerA, tenant: T.A, body: {} });
    await ok(PlanCurrentOutput, "service-ops", "plan.current", { as: U.ownerA, tenant: T.A, body: {} });
  });
});
