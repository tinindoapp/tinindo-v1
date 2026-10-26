// P43 pelos handlers com o banco real e o canal simulado: o visitante vê serviços e horários do perfil → pede o horário
// (provisória + código) → o despacho do canal entrega o código no telefone simulado → código errado não confirma, o
// certo confirma → o dono vê na Agenda com origem public_link → outra pessoa não pega o mesmo horário → cliente com
// vínculo vê a provisória em "Minhas reservas". SEC: perfil sem link, chave obrigatória, nada de contato na resposta.
import { afterAll, describe, expect, it } from "vitest";
import { AvailabilityListOutput, BookingListOutput, PublicBookOutput, PublicConfirmOutput, PublicServicesOutput } from "@contracts";
import { call, fails, FX, newKey, nextWeek, ok, plusMin, pool, rpc, runDispatch, sql, T, U } from "./harness.ts";

const SLUG = "barbearia-exemplo-a";
const VISITOR = "+5511977774343";
const RIVAL = "+5511977774344";
const BUSINESS = "+5511999994343";
afterAll(() => pool.end());

/** Último código que o telefone simulado do visitante recebeu (como a pessoa leria no WhatsApp). */
async function codeOnPhone(phone: string): Promise<string> {
  const rows = await sql<{ body: string }>("select body from public.channel_sim_phone where phone_e164 = $1 order by id desc limit 1", [phone]);
  const m = /é (\d{6})\./.exec(rows[0]?.body ?? "");
  if (!m) throw new Error(`nenhum código no telefone ${phone}: ${rows[0]?.body ?? "(vazio)"}`);
  return m[1]!;
}

describe("P43 · reserva pelo link público", () => {
  let slot = { starts_at: "", ends_at: "" };
  let lastFree = "";
  let requestId = "";
  let bookKey = "";

  it("0 · perfil publicado com o link, expediente e canal ativo do negócio", async () => {
    const rules = [1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, local_start: "09:00", local_end: "19:00" }));
    const [{ version }] = await sql<{ version: number }>("select version from public.resources where id = $1", [FX.resources.A]);
    expect((await rpc(U.ownerA, "scheduling_rules_save", { p_tenant_id: T.A, p_resource_id: FX.resources.A, p_expected_version: version,
      p_rules: rules, p_idem_key: newKey(), p_request_hash: "a".repeat(64) })).error).toBeNull();
    await sql(`insert into public.public_profiles (tenant_id, slug, category, area, public_fields, published_at)
      values ($1, $2, 'barber', 'Pinheiros', array['area','display_name','booking_link'], now())
      on conflict (tenant_id) do update set slug = $2, public_fields = array['area','display_name','booking_link'], published_at = now()`, [T.A, SLUG]);
    const active = await sql("select id from public.channel_connections where tenant_id = $1 and status = 'active'", [T.A]);
    if (active.length === 0) {
      await sql(`insert into public.channel_connections (tenant_id, provider, external_account_id, phone_e164, status, verified_at)
        values ($1, 'simulated', $2, $2, 'active', now())`, [T.A, BUSINESS]);
    }
  });

  it("1 · visitante vê serviços (sem preço) e horários livres", async () => {
    const s = await ok(PublicServicesOutput, "network", "public.services", { as: null, body: { slug: SLUG } });
    expect(s.services.map((x) => x.name)).toEqual(expect.arrayContaining(["Corte", "Barba"]));
    expect(JSON.stringify(s)).not.toMatch(/price|cents/);
    const monday = await nextWeek(1, "09:00");
    const slots = await ok(AvailabilityListOutput, "network", "public.slots", { as: null,
      body: { slug: SLUG, service_id: FX.services.corteA, window: { starts_at: monday, ends_at: plusMin(monday, 600) } } });
    expect(slots.slots.length).toBeGreaterThan(0);
    slot = slots.slots[0]!;
    lastFree = slots.slots.at(-1)!.starts_at;
  });

  it("2 · pedir o horário segura a vaga e manda o código; repetir o pedido não cria outro", async () => {
    bookKey = `p43-pedido-${crypto.randomUUID()}`;
    const body = { slug: SLUG, service_id: FX.services.corteA, starts_at: slot.starts_at, contact: { name: "Maria Visitante", phone_e164: VISITOR } };
    const r = await call("network", "public.book", { as: null, key: bookKey, body });
    expect(r.status).toBe(201);
    const first = PublicBookOutput.parse(r.data);
    expect(first.slot).toEqual(slot);
    expect(JSON.stringify(first)).not.toMatch(/5511977774343|Maria|"code"/);
    requestId = first.request_id;
    const again = await ok(PublicBookOutput, "network", "public.book", { as: null, key: bookKey, body });
    expect(again.request_id).toBe(requestId);
    await fails("network", "public.book", { as: null, key: bookKey, body: { ...body, contact: { ...body.contact, name: "Outra" } } }, "IDEMPOTENCY_MISMATCH");
    const [b] = await sql<{ status: string; source: string }>(
      "select b.status, b.source from public.bookings b join public.public_booking_requests q on q.booking_id = b.id where q.id = $1", [requestId]);
    expect(b).toEqual({ status: "held", source: "public_link" });
  });

  it("3 · outra pessoa não pega o mesmo horário enquanto está segurado", async () => {
    await fails("network", "public.book", { as: null, key: true,
      body: { slug: SLUG, service_id: FX.services.corteA, starts_at: slot.starts_at, contact: { name: "Rival", phone_e164: RIVAL } } }, "SLOT_CONFLICT");
  });

  it("4 · o código chega pelo canal; errado não confirma, o certo confirma (e repetir dá o mesmo)", async () => {
    expect((await runDispatch()).sent).toBeGreaterThan(0);
    const code = await codeOnPhone(VISITOR);
    const wrong = String((Number(code) + 1) % 1_000_000).padStart(6, "0");
    await fails("network", "public.confirm", { as: null, key: true, body: { request_id: requestId, code: wrong } }, "POLICY_REJECTED", "code");
    const done = await ok(PublicConfirmOutput, "network", "public.confirm", { as: null, key: true, body: { request_id: requestId, code } });
    expect(done).toMatchObject({ status: "confirmed", slot, service_name: "Corte", timezone: "America/Sao_Paulo" });
    const again = await ok(PublicConfirmOutput, "network", "public.confirm", { as: null, key: true, body: { request_id: requestId, code } });
    expect(again).toEqual(done);
  });

  it("5 · o dono vê a reserva confirmada na Agenda, com origem public_link e preço base", async () => {
    const list = await ok(BookingListOutput, "scheduling", "booking.list", { as: U.ownerA, tenant: T.A,
      body: { window: { starts_at: plusMin(slot.starts_at, -1), ends_at: plusMin(slot.ends_at, 1) } } });
    const mine = list.bookings.filter((b) => b.starts_at === slot.starts_at && b.status === "confirmed");
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ source: "public_link", customer_id: null, agreed_price_cents: 6000 });
  });

  it("6 · cliente com vínculo reserva no próprio cadastro e vê a provisória em Minhas reservas", async () => {
    await sql(`insert into public.customer_links (tenant_id, customer_id, user_id, verification_method, verified_at)
      values ($1, $2, $3, 'owner_invite_code', now()) on conflict do nothing`, [T.A, FX.customers.abInA, U.customerAB]);
    // Último horário livre do dia (longe do que o visitante segurou).
    const later = lastFree;
    const r = await ok(PublicBookOutput, "network", "public.book", { as: U.customerAB, key: true,
      body: { slug: SLUG, service_id: FX.services.corteA, starts_at: later, contact: { name: "Ana", phone_e164: "+5511977774345" } } });
    expect(r.slot.starts_at).toBe(later);
    const res = await rpc(U.customerAB, "my_bookings", {});
    const rows = (res.data ?? []) as { starts_at: string; status: string }[];
    expect(rows.some((x) => Date.parse(x.starts_at) === Date.parse(later) && x.status === "held")).toBe(true);
  });

  it("SEC · perfil sem link não aceita; chave obrigatória; telefone inválido; nada de contato no CRM", async () => {
    const customersBefore = await sql<{ n: number }>("select count(*)::int as n from public.customers where tenant_id = $1", [T.A]);
    await fails("network", "public.book", { as: null,
      body: { slug: SLUG, service_id: FX.services.corteA, starts_at: slot.starts_at, contact: { name: "Sem chave", phone_e164: RIVAL } } },
      "VALIDATION_ERROR", "idempotency_key");
    await fails("network", "public.book", { as: null, key: true,
      body: { slug: SLUG, service_id: FX.services.corteA, starts_at: slot.starts_at, contact: { name: "Tel", phone_e164: "11977774343" } } },
      "VALIDATION_ERROR", "contact.phone_e164");
    await sql("update public.public_profiles set public_fields = array['area','display_name'] where tenant_id = $1", [T.A]);
    await fails("network", "public.services", { as: null, body: { slug: SLUG } }, "NOT_FOUND");
    await sql("update public.public_profiles set public_fields = array['area','display_name','booking_link'] where tenant_id = $1", [T.A]);
    expect(await sql("select count(*)::int as n from public.customers where tenant_id = $1", [T.A])).toEqual(customersBefore);
  });
});
