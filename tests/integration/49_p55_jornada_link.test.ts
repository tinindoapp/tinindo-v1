// P55 pelos handlers com o banco real e o canal simulado: campos do perfil (D21) → pedido mostra preço, local e
// política (D23) → estado do envio e reenvio → número corrigido mantém o horário → 5 códigos errados liberam o horário
// e pedir de novo zera as tentativas → confirmar devolve o link da reserva (D20) → o cliente vê a reserva e avalia sem
// conta → o dono gera o link para um atendimento da Agenda. Domicílio exige bairro. SEC: outro dono, token inválido.
import { afterAll, describe, expect, it } from "vitest";
import {
  AvailabilityListOutput,
  BookingLinkIssueOutput,
  BookingLinkReviewOutput,
  BookingLinkView,
  OwnerProfileOutput,
  PublicBookOutput,
  PublicConfirmOutput,
  PublicProfile,
  PublicRequestState,
} from "@contracts";
import { call, fails, FX, newKey, nextWeek, ok, plusMin, pool, rpc, runDispatch, sql, T, U } from "./harness.ts";

const SLUG = "barbearia-p55-jornada";
const WRONG = "+5511966665501";
const RIGHT = "+5511966665502";
const BUSINESS = "+5511999995555";
afterAll(() => pool.end());

async function codeOnPhone(phone: string): Promise<{ code: string; body: string }> {
  const rows = await sql<{ body: string }>("select body from public.channel_sim_phone where phone_e164 = $1 order by id desc limit 1", [phone]);
  const body = rows[0]?.body ?? "";
  const m = /: (\d{6})\./.exec(body);
  if (!m) throw new Error(`nenhum código no telefone ${phone}: ${body || "(vazio)"}`);
  return { code: m[1]!, body };
}

describe("P55 · jornada do link público", () => {
  let slots: string[] = [];
  let first = "";
  let token = "";

  it("0 · perfil com link, expediente, canal e os campos D21", async () => {
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
    const owner = await ok(OwnerProfileOutput, "network", "profile.details", { as: U.ownerA, tenant: T.A, key: true,
      body: { address: "Rua das Flores, 10", home_service: false, opening_hours: "Seg a sáb, 9h às 19h", cancellation_policy: "Cancele com 2 horas de antecedência." } });
    expect(owner.profile?.details?.address).toBe("Rua das Flores, 10");
    const pub = await ok(PublicProfile, "network", "public.profile", { as: null, query: { slug: SLUG } });
    expect(pub.details?.cancellation_policy).toBe("Cancele com 2 horas de antecedência.");
    await fails("network", "profile.details", { as: U.ownerB, tenant: T.A, key: true,
      body: { address: null, home_service: true, opening_hours: null, cancellation_policy: null } }, "FORBIDDEN");
    const monday = await nextWeek(1, "09:00");
    const free = await ok(AvailabilityListOutput, "network", "public.slots", { as: null,
      body: { slug: SLUG, service_id: FX.services.corteA, window: { starts_at: monday, ends_at: plusMin(monday, 600) } } });
    slots = free.slots.map((s) => s.starts_at);
    expect(slots.length).toBeGreaterThan(3);
  });

  it("1 · antes de confirmar: preço, local e política; o código sai com o nome do negócio", async () => {
    const r = await ok(PublicBookOutput, "network", "public.book", { as: null, key: true,
      body: { slug: SLUG, service_id: FX.services.corteA, starts_at: slots[0], contact: { name: "Bia", phone_e164: WRONG } } });
    first = r.request_id;
    expect(r.price_cents).toBe(6000);
    expect(r.place).toEqual({ kind: "address", text: "Rua das Flores, 10" });
    expect(r.policy).toBe("Cancele com 2 horas de antecedência.");
    expect([r.attempts_left, r.resends_left]).toEqual([5, 2]);
    const s0 = await ok(PublicRequestState, "network", "public.status", { as: null, body: { request_id: first } });
    expect(s0.delivery).toBe("queued");
    await runDispatch();
    const s1 = await ok(PublicRequestState, "network", "public.status", { as: null, body: { request_id: first } });
    expect(s1.delivery).toBe("sent");
    const { body } = await codeOnPhone(WRONG);
    const [{ name }] = await sql<{ name: string }>("select name from public.tenants where id = $1", [T.A]);
    expect(body.startsWith(`Código de ${name}:`)).toBe(true);
    await fails("network", "public.resend", { as: null, key: true, body: { request_id: first } }, "QUOTA_EXCEEDED");
  });

  it("2 · corrigir o número pede o mesmo horário de novo, sem conflito consigo mesmo", async () => {
    const r = await call("network", "public.book", { as: null, key: true,
      body: { slug: SLUG, service_id: FX.services.corteA, starts_at: slots[0], contact: { name: "Bia", phone_e164: RIGHT }, supersedes_request_id: first } });
    expect(r.status).toBe(201);
    const old = await ok(PublicRequestState, "network", "public.status", { as: null, body: { request_id: first } });
    expect(old.status).toBe("expired");
    const next = PublicBookOutput.parse(r.data);
    // 5 códigos errados: a 5ª libera o horário; pedir de novo zera as tentativas.
    for (let i = 4; i >= 1; i--) {
      const e = await call("network", "public.confirm", { as: null, key: true, body: { request_id: next.request_id, code: "000000" } });
      expect(e.error?.field).toBe("code");
      expect(e.error?.details).toEqual({ attempts_left: i });
    }
    await fails("network", "public.confirm", { as: null, key: true, body: { request_id: next.request_id, code: "000000" } }, "POLICY_REJECTED", "attempts");
    const [{ status }] = await sql<{ status: string }>(
      "select b.status from public.bookings b join public.public_booking_requests q on q.booking_id = b.id where q.id = $1", [next.request_id]);
    expect(status).toBe("expired");
    const again = await ok(PublicBookOutput, "network", "public.book", { as: null, key: true,
      body: { slug: SLUG, service_id: FX.services.corteA, starts_at: slots[0], contact: { name: "Bia", phone_e164: RIGHT } } });
    expect(again.attempts_left).toBe(5);
    await runDispatch();
    const conf = await ok(PublicConfirmOutput, "network", "public.confirm", { as: null, key: true,
      body: { request_id: again.request_id, code: (await codeOnPhone(RIGHT)).code } });
    expect(conf.booking_token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(conf.place).toEqual({ kind: "address", text: "Rua das Flores, 10" });
    token = conf.booking_token!;
  });

  it("3 · o cliente vê a reserva pelo link e avalia sem conta depois do atendimento", async () => {
    const view = await ok(BookingLinkView, "network", "public.booking", { as: null, body: { token } });
    expect(view.status).toBe("confirmed");
    expect(view.business.slug).toBe(SLUG);
    expect(JSON.stringify(view)).not.toMatch(/5511966665502|Bia|tenant/);
    expect(view.review.can_review).toBe(false);
    await sql(`update public.bookings b set status = 'completed', starts_at = now() - interval '2 hours', ends_at = now() - interval '90 minutes',
      occupied_range = tstzrange(now() - interval '2 hours', now() - interval '80 minutes', '[)')
      from public.booking_links l where l.booking_id = b.id and l.token_hash = encode(extensions.digest($1, 'sha256'), 'hex')`, [token]);
    const after = await ok(BookingLinkView, "network", "public.booking", { as: null, body: { token } });
    expect(after.review.can_review).toBe(true);
    const rev = await ok(BookingLinkReviewOutput, "network", "public.review", { as: null, key: true, body: { token, rating: 5, body: "Pontual e caprichoso." } });
    expect(rev.review.status).toBe("published");
    const list = await call("reputation", "review.public_list", { as: null, body: { slug: SLUG } });
    expect(JSON.stringify(list.data)).toContain("Pontual e caprichoso.");
    await fails("network", "public.booking", { as: null, body: { token: "A".repeat(43) } }, "NOT_FOUND");
  });

  it("4 · o dono gera o link de um atendimento; outro dono não", async () => {
    const [{ booking_id }] = await sql<{ booking_id: string }>(
      "select booking_id from public.booking_links where token_hash = encode(extensions.digest($1, 'sha256'), 'hex')", [token]);
    const issued = await ok(BookingLinkIssueOutput, "network", "booking_link.issue", { as: U.ownerA, tenant: T.A, key: true, body: { booking_id } });
    expect(issued.url).toBe(`https://app.exemplo.test/reserva/${SLUG}#t=${issued.token}`);
    await fails("network", "booking_link.issue", { as: U.ownerB, tenant: T.A, key: true, body: { booking_id } }, "FORBIDDEN");
  });

  it("5 · a domicílio, o pedido exige o bairro e o dono o vê", async () => {
    await ok(OwnerProfileOutput, "network", "profile.details", { as: U.ownerA, tenant: T.A, key: true,
      body: { address: null, home_service: true, opening_hours: null, cancellation_policy: null } });
    await fails("network", "public.book", { as: null, key: true,
      body: { slug: SLUG, service_id: FX.services.corteA, starts_at: slots[2], contact: { name: "Caio", phone_e164: "+5511966665503" } } },
      "VALIDATION_ERROR", "neighborhood");
    const r = await ok(PublicBookOutput, "network", "public.book", { as: null, key: true,
      body: { slug: SLUG, service_id: FX.services.corteA, starts_at: slots[2], contact: { name: "Caio", phone_e164: "+5511966665503" }, neighborhood: "Moema" } });
    expect(r.place).toEqual({ kind: "home" });
    const [{ booking_id }] = await sql<{ booking_id: string }>("select booking_id from public.public_booking_requests where id = $1", [r.request_id]);
    const contact = await call("network", "public.contact", { as: U.ownerA, tenant: T.A, body: { booking_id } });
    expect((contact.data as { neighborhood?: string }).neighborhood).toBe("Moema");
  });
});
