// P44 pelos handlers com o banco real: um negócio novo (identity) → setup.progress com 0 de 8 → expediente (P03) →
// serviços pelos modelos (setup → P02) → política (identity) → perfil publicado (network) → pronto em 24 h, e o link
// público responde com horários. Dispensa só de opcional; rascunho "descreva seu negócio" aplicado tudo ou nada;
// evento uma vez por passo; indicador do P18 para a operadora. SEC: outro dono, cliente e anônimo.
import { afterAll, describe, expect, it } from "vitest";
import { AvailabilityListOutput, BusinessCreateOutput, CostToServeOutput, OnboardingSaveOutput, PublicProfile, ScheduleSettings, SetupDismissOutput,
  SetupDraftApplyOutput, SetupProgressOutput, SetupServicesApplyOutput, SetupTemplatesOutput } from "@contracts";
import { call, fails, FX, newKey, nextWeek, ok, pool, sql, T, U } from "./harness.ts";

afterAll(() => pool.end());
const OPERATOR = "e0000000-0000-4000-8000-0000000000e1";

describe("P44 · configuração guiada pelos handlers", () => {
  let tenant = "";
  let resource = "";
  const owner = () => ({ as: U.outsider, tenant });
  const stepOf = (p: { steps: { step: string; done: boolean; dismissed: boolean; why: string | null; link: string }[] }, step: string) => p.steps.find((s) => s.step === step)!;

  it("0 · negócio novo: 0 de 8, próximo = horários, cada passo com por quê e link; nenhum evento", async () => {
    const created = await ok(BusinessCreateOutput, "identity", "business.create", { as: U.outsider, key: true, body: {
      name: "Barbearia Nova (int)", profession: "barber", accepted_policy_versions: ["termos-piloto-v0", "privacidade-piloto-v0"] } });
    tenant = created.tenant.id;
    resource = created.resource_id;
    const p = await ok(SetupProgressOutput, "setup", "setup.progress", { ...owner(), body: {} });
    expect(p).toMatchObject({ done_count: 0, total: 8, next: "hours", ready: false, business_name: "Barbearia Nova (int)", profession: "barber" });
    expect(p.steps.every((s) => s.why && s.link.startsWith("/app/"))).toBe(true);
    expect(stepOf(p, "hours").link).toBe("/app/agenda/horarios");
    const [{ n }] = await sql<{ n: number }>("select count(*)::int as n from public.outbox_events where tenant_id = $1 and event_type = 'setup.step_completed.v1'", [tenant]);
    expect(n).toBe(0);
  });

  it("1 · expediente pela agenda → passo feito pela data real; evento uma vez", async () => {
    const settings = await ok(ScheduleSettings, "scheduling", "schedule.settings", { ...owner(), body: {} });
    await ok(ScheduleSettings, "scheduling", "schedule.rules_save", { ...owner(), key: true, body: { resource_id: resource, expected_version: settings.resource_version,
      rules: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, local_start: "09:00", local_end: "19:00" })) } });
    const p = await ok(SetupProgressOutput, "setup", "setup.progress", { ...owner(), body: {} });
    expect(stepOf(p, "hours")).toMatchObject({ done: true, why: null });
    expect(p.next).toBe("service");
    await ok(SetupProgressOutput, "setup", "setup.progress", { ...owner(), body: {} });
    const rows = await sql<{ step: string; secs: string }>("select payload->>'step' as step, payload->>'seconds_since_signup' as secs from public.outbox_events where tenant_id = $1 and event_type = 'setup.step_completed.v1'", [tenant]);
    expect(rows.map((r) => r.step)).toEqual(["hours"]);
    expect(Number(rows[0]!.secs)).toBeGreaterThanOrEqual(0);
  });

  it("2 · modelos da profissão → criar os marcados com o preço do dono (201, idempotente, tudo ou nada)", async () => {
    const t = await ok(SetupTemplatesOutput, "setup", "setup.templates", { ...owner(), body: {} });
    expect(t.profession).toBe("barber");
    expect(t.templates.map((x) => [x.code, x.exists])).toEqual([["barber_corte", false], ["barber_barba", false], ["barber_corte_barba", false]]);
    await fails("setup", "setup.services_apply", { ...owner(), key: true, body: { services: [
      { template_code: "barber_corte", name: "Corte", duration_min: 30, base_price_cents: 5000 }, { name: "corte", duration_min: 30, base_price_cents: 1 }] } }, "VALIDATION_ERROR", "name");
    expect((await sql<{ n: number }>("select count(*)::int as n from public.provider_services where tenant_id = $1", [tenant]))[0]!.n).toBe(0);
    const key = newKey();
    const body = { services: [{ template_code: "barber_corte", name: "Corte", duration_min: 30, base_price_cents: 5000 }, { template_code: "barber_barba", name: "Barba", duration_min: 20, base_price_cents: 3000 }] };
    const r = await call("setup", "setup.services_apply", { ...owner(), key, body });
    expect(r.status).toBe(201);
    const out = SetupServicesApplyOutput.parse(r.data);
    expect(out.created.map((c) => c.name)).toEqual(["Corte", "Barba"]);
    expect(stepOf(out.progress, "service").done).toBe(true);
    expect(SetupServicesApplyOutput.parse((await call("setup", "setup.services_apply", { ...owner(), key, body })).data)).toEqual(out);
    expect((await sql<{ n: number }>("select count(*)::int as n from public.provider_services where tenant_id = $1 and active", [tenant]))[0]!.n).toBe(2);
    expect((await ok(SetupTemplatesOutput, "setup", "setup.templates", { ...owner(), body: {} })).templates.map((x) => x.exists)).toEqual([true, true, false]);
  });

  it("3 · política (identity) e perfil (network) → pronto em 24 h; o link público responde com horários", async () => {
    await ok(OnboardingSaveOutput, "identity", "onboarding.save", { ...owner(), key: true, body: { expected_version: 1, goal: "fill_schedule", cancellation_notice_hours: 24, mark_complete: true } });
    let p = await ok(SetupProgressOutput, "setup", "setup.progress", { ...owner(), body: {} });
    expect(stepOf(p, "cancellation_policy").done).toBe(true);
    expect(p.next).toBe("profile");
    expect(p.ready).toBe(false);
    await ok(PublicProfile, "network", "profile.publish", { ...owner(), key: true, body: {
      slug: "barbearia-nova-int", category: "barber", area: "Centro", public_fields: ["display_name", "category", "area", "booking_link"] } });
    p = await ok(SetupProgressOutput, "setup", "setup.progress", { ...owner(), body: {} });
    expect(p).toMatchObject({ ready: true, ready_in_24h: true, done_count: 4, next: "first_customer" });
    expect(p.ready_at).not.toBeNull();
    const pub = await call("network", "public.profile", { as: null, method: "GET", query: { slug: "barbearia-nova-int" } });
    expect(pub.status).toBe(200);
    const serviceId = (await sql<{ id: string }>("select id from public.provider_services where tenant_id = $1 and name = 'Corte'", [tenant]))[0]!.id;
    const slots = await ok(AvailabilityListOutput, "network", "public.slots", { as: null, body: {
      slug: "barbearia-nova-int", service_id: serviceId, window: { starts_at: await nextWeek(2, "09:00"), ends_at: await nextWeek(2, "19:00") } } });
    expect(slots.slots.length).toBeGreaterThan(10);
    const rows = await sql<{ step: string; ready: string }>("select payload->>'step' as step, payload->>'ready' as ready from public.outbox_events where tenant_id = $1 and event_type = 'setup.step_completed.v1' order by occurred_at, aggregate_version", [tenant]);
    expect(rows.map((r) => r.step)).toEqual(["hours", "service", "cancellation_policy", "profile"]);
    expect(rows[3]!.ready).toBe("true");
  });

  it("4 · dispensar: só opcional; obrigatório → 400 no campo step; desfazer", async () => {
    await fails("setup", "setup.dismiss", { ...owner(), key: true, body: { step: "hours" } }, "VALIDATION_ERROR", "step");
    const d = await ok(SetupDismissOutput, "setup", "setup.dismiss", { ...owner(), key: true, body: { step: "first_customer" } });
    expect(d).toMatchObject({ step: "first_customer", dismissed: true });
    expect(d.progress.next).toBe("photo_whatsapp");
    expect(d.progress.resolved_count).toBe(5);
    const back = await ok(SetupDismissOutput, "setup", "setup.dismiss", { ...owner(), key: true, body: { step: "first_customer", dismissed: false } });
    expect(stepOf(back.progress, "first_customer").dismissed).toBe(false);
  });

  it("5 · rascunho revisado: profissão, expediente (substitui) e serviço, tudo ou nada e idempotente", async () => {
    await fails("setup", "setup.draft_apply", { ...owner(), key: true, body: { profession: "hairdresser", hours: [{ weekday: 1, local_start: "09:00", local_end: "12:00" }, { weekday: 1, local_start: "11:00", local_end: "13:00" }] } }, "VALIDATION_ERROR", "rules");
    expect((await sql<{ profession: string }>("select profession from public.tenants where id = $1", [tenant]))[0]!.profession).toBe("barber");
    const key = newKey();
    const body = { profession: "hairdresser", hours: [1, 2, 3].map((weekday) => ({ weekday, local_start: "10:00", local_end: "16:00" })), services: [{ name: "Escova", duration_min: 40, base_price_cents: 6000 }] };
    const out = await ok(SetupDraftApplyOutput, "setup", "setup.draft_apply", { ...owner(), key, body });
    expect(out.profession).toBe("hairdresser");
    expect(out.hours).toHaveLength(3);
    expect(out.created.map((c) => c.name)).toEqual(["Escova"]);
    expect(await ok(SetupDraftApplyOutput, "setup", "setup.draft_apply", { ...owner(), key, body })).toEqual(out);
    expect((await sql<{ n: number }>("select count(*)::int as n from public.availability_rules where tenant_id = $1", [tenant]))[0]!.n).toBe(3);
    expect((await sql<{ n: number }>("select count(*)::int as n from public.provider_services where tenant_id = $1 and name = 'Escova'", [tenant]))[0]!.n).toBe(1);
    expect((await ok(SetupTemplatesOutput, "setup", "setup.templates", { ...owner(), body: {} })).profession).toBe("hairdresser");
  });

  it("6 · indicador do P18: a operadora vê negócios prontos em 24 h; o dono não", async () => {
    await sql("insert into public.platform_operators (user_id, display_name) values ($1, 'Operadora (exemplo)') on conflict do nothing", [OPERATOR]);
    const end = new Date();
    const cost = await ok(CostToServeOutput, "analytics", "analytics.cost_to_serve", { as: OPERATOR, body: { period: { starts_at: new Date(end.getTime() - 86_400_000).toISOString(), ends_at: end.toISOString() }, hourly_cost_cents: 6000 } });
    expect(cost.setup_ready_24h.businesses).toBeGreaterThanOrEqual(1);
    expect(cost.setup_ready_24h.ready_in_24h).toBeGreaterThanOrEqual(1);
    await fails("analytics", "analytics.cost_to_serve", { as: U.outsider, body: { period: { starts_at: new Date(end.getTime() - 86_400_000).toISOString(), ends_at: end.toISOString() }, hourly_cost_cents: 6000 } }, "FORBIDDEN");
  });

  it("SEC · outro dono, cliente e anônimo não leem nem mudam a configuração do negócio novo", async () => {
    await fails("setup", "setup.progress", { as: U.ownerB, tenant, body: {} }, "FORBIDDEN");
    await fails("setup", "setup.templates", { as: FX.users.customerAB, tenant, body: {} }, "FORBIDDEN");
    await fails("setup", "setup.dismiss", { as: U.ownerB, tenant, key: true, body: { step: "channel" } }, "FORBIDDEN");
    await fails("setup", "setup.services_apply", { as: U.ownerB, tenant, key: true, body: { services: [{ name: "X", duration_min: 30, base_price_cents: 100 }] } }, "FORBIDDEN");
    await fails("setup", "setup.progress", { as: U.ownerB, tenant: T.A, body: {} }, "FORBIDDEN");
    expect((await call("setup", "setup.progress", { as: null, tenant, body: {} })).status).toBe(401);
  });
});
