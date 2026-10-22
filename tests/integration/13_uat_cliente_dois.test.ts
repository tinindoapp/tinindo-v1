// UAT · Cliente de dois profissionais (docs/10) com o banco real: a mesma conta vincula-se por código a A e a B,
// vê só as próprias reservas em cada um, não vê notas, lista de clientes nem custos; o profissional A não
// descobre o histórico da cliente com B (SEC-01/SEC-02 com RLS de verdade).
import { afterAll, describe, expect, it } from "vitest";
import { BookingOutput, CustomerLinkIssueOutput, CustomerLinkRedeemOutput, ScheduleSettings } from "@contracts";
import { fails, FX, nextWeek, ok, plusMin, pool, rpc, T, U } from "./harness.ts";

afterAll(() => pool.end());

/** Leitura direta com a sessão do usuário (como o supabase-js faria pela RLS). */
async function selectAs(user: string, text: string) {
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: user, role: "authenticated" })]);
    await c.query("set local role authenticated");
    const r = await c.query(text);
    await c.query("rollback");
    return r.rows;
  } finally {
    c.release();
  }
}

describe("UAT cliente de dois profissionais", () => {
  const bookings: Record<string, string> = {};

  it("0 · cada dono agenda a cliente AB e um outro cliente no próprio negócio", async () => {
    for (const [owner, tenant, resource, service, customer, other] of [
      [U.ownerA, T.A, FX.resources.A, FX.services.corteA, FX.customers.abInA, FX.customers.guestInA],
      [U.ownerB, T.B, FX.resources.B, FX.services.sessaoB, FX.customers.abInB, null],
    ] as const) {
      const o = { as: owner, tenant };
      const settings = await ok(ScheduleSettings, "scheduling", "schedule.settings", { ...o, body: {} });
      await ok(ScheduleSettings, "scheduling", "schedule.rules_save", { ...o, key: true, body: { resource_id: resource, expected_version: settings.resource_version,
        rules: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, local_start: "08:00", local_end: "20:00" })) } });
      const dur = service === FX.services.corteA ? 30 : 60;
      const t1 = await nextWeek(3, "10:00");
      const b = await ok(BookingOutput, "scheduling", "booking.create", { ...o, key: true, body: {
        customer_id: customer, guest_ref: null, service_id: service, resource_id: resource, slot: { starts_at: t1, ends_at: plusMin(t1, dur) }, quote_id: null, mode: "confirm" } });
      bookings[tenant] = b.booking.id;
      if (other) {
        const t2 = await nextWeek(3, "14:00");
        const ob = await ok(BookingOutput, "scheduling", "booking.create", { ...o, key: true, body: {
          customer_id: other, guest_ref: null, service_id: service, resource_id: resource, slot: { starts_at: t2, ends_at: plusMin(t2, dur) }, quote_id: null, mode: "confirm" } });
        bookings.otherInA = ob.booking.id;
      }
    }
  });

  it("1 · vínculo por código em A e em B; o código é de uso único e o dono não se vincula ao próprio negócio", async () => {
    for (const [owner, tenant, customer] of [[U.ownerA, T.A, FX.customers.abInA], [U.ownerB, T.B, FX.customers.abInB]] as const) {
      const issued = await ok(CustomerLinkIssueOutput, "identity", "customer_link.issue", { as: owner, tenant, key: true, body: { customer_id: customer } });
      expect(issued.code).toMatch(/^[A-Za-z0-9_-]{43}$/);
      await fails("identity", "customer_link.redeem", { as: owner, key: true, body: { code: issued.code } }, "POLICY_REJECTED");
      const redeemed = await ok(CustomerLinkRedeemOutput, "identity", "customer_link.redeem", { as: U.customerAB, key: true, body: { code: issued.code } });
      expect(redeemed.tenant_id).toBe(tenant);
      await fails("identity", "customer_link.redeem", { as: U.outsider, key: true, body: { code: issued.code } }, "NOT_FOUND");
    }
    const links = await rpc(U.customerAB, "my_customer_links", {});
    expect((links.data as { tenant_name: string }[]).map((l) => l.tenant_name).sort()).toEqual(["Barbearia Exemplo A", "Personal Exemplo B"]);
  });

  it("2 · a cliente vê as próprias reservas nos dois negócios e nada de outros clientes", async () => {
    const mine = await selectAs(U.customerAB, "select id, tenant_id, customer_id from public.bookings order by tenant_id");
    expect(mine.map((r) => r.id)).toEqual(expect.arrayContaining([bookings[T.A], bookings[T.B]]));
    expect(mine.map((r) => r.id)).not.toContain(bookings.otherInA);
    // Só reservas dela, nos dois negócios: nenhuma de outro cliente.
    expect(mine.every((r) => r.customer_id === FX.customers.abInA || r.customer_id === FX.customers.abInB)).toBe(true);
    expect(new Set(mine.map((r) => r.tenant_id))).toEqual(new Set([T.A, T.B]));
  });

  it("3 · a cliente não vê a lista de clientes, custos, notas nem o caixa", async () => {
    expect(await selectAs(U.customerAB, "select id from public.customers")).toEqual([]);
    expect(await selectAs(U.customerAB, "select id from public.receivables")).toEqual([]);
    expect(await selectAs(U.customerAB, "select id from public.payment_entries")).toEqual([]);
    expect(await selectAs(U.customerAB, "select id from public.audit_events")).toEqual([]);
    // Pelos handlers, o papel de cliente não tem nenhuma rota de dono.
    await fails("crm", "customers", { as: U.customerAB, tenant: T.A, method: "GET" }, "FORBIDDEN");
    await fails("crm", "services", { as: U.customerAB, tenant: T.A, method: "GET" }, "FORBIDDEN");
    await fails("finance", "package.list", { as: U.customerAB, tenant: T.B, body: {} }, "FORBIDDEN");
  });

  it("4 · o profissional A não descobre o histórico da cliente com B, mesmo sendo a mesma pessoa", async () => {
    const seenByA = await selectAs(U.ownerA, "select id, tenant_id from public.bookings");
    expect(seenByA.every((r) => r.tenant_id === T.A)).toBe(true);
    expect(seenByA.map((r) => r.id)).not.toContain(bookings[T.B]);
    expect(await selectAs(U.ownerA, `select id from public.customers where tenant_id = '${T.B}'`)).toEqual([]);
    expect(await selectAs(U.ownerA, `select id from public.customer_links where tenant_id = '${T.B}'`)).toEqual([]);
    await fails("scheduling", "booking.get", { as: U.ownerA, tenant: T.A, body: { booking_id: bookings[T.B] } }, "NOT_FOUND");
    await fails("scheduling", "booking.get", { as: U.ownerA, tenant: T.B, body: { booking_id: bookings[T.B] } }, "FORBIDDEN");
  });
});
