// P45 pelos handlers com o banco real: o worker `jobs` roda o motor uma vez por dia por negócio → a Home lê até 3
// insights com período e denominador (contrato) → "Ver" registra a decisão (P22) e devolve a tela do fluxo →
// "Preparar" cria a regra de preço como PROPOSTA no P05 (nada publicado) → "Agora não" silencia → resumo semanal.
// SEC: outro dono.
import { afterAll, describe, expect, it } from "vitest";
import { DigestListOutput, InsightCommandOutput, InsightListOutput } from "@contracts";
import { fails, ok, pool, runJobs, sql, U } from "./harness.ts";

const TENANT = "51000000-0000-4000-8000-000000000045";
const RES = "52000000-0000-4000-8000-000000000045";
const SVC = "53000000-0000-4000-8000-000000000045";
const owner = { as: U.ownerA, tenant: TENANT };
afterAll(() => pool.end());

describe("P45 · insights proativos pelos handlers", () => {
  it("0 · negócio com 200 dias: 6 concluídos sem cobrança e terça 14–16 vazia nas 5 semanas", async () => {
    await sql("insert into public.tenants (id, name, profession, timezone, created_at) values ($1, 'Barbearia P45', 'barber', 'America/Sao_Paulo', now() - interval '200 days')", [TENANT]);
    await sql("insert into public.tenant_memberships (tenant_id, user_id, role) values ($1, $2, 'owner')", [TENANT, U.ownerA]);
    await sql("insert into public.resources (id, tenant_id, name) values ($1, $2, 'Profissional')", [RES, TENANT]);
    await sql("insert into public.provider_services (id, tenant_id, name, duration_min, base_price_cents, min_price_cents, active) values ($1, $2, 'Corte', 30, 6000, 4500, true)", [SVC, TENANT]);
    await sql("insert into public.availability_rules (tenant_id, resource_id, weekday, local_start, local_end) values ($1, $2, 1, '09:00', '11:00'), ($1, $2, 2, '14:00', '16:00')", [TENANT, RES]);
    // Segundas das 5 semanas encerradas, 9h e 10h: 10 concluídos (os 6 mais recentes sem cobrança entram nos últimos 30 dias).
    await sql(`insert into public.bookings (tenant_id, resource_id, service_id, starts_at, ends_at, occupied_range, blocks_capacity, status, agreed_price_cents, source)
      select $1, $2, $3, s, s + interval '30 minutes', tstzrange(s, s + interval '30 minutes', '[)'), true, 'completed', 6000, 'owner'
      from (select ((date_trunc('week', now() at time zone 'America/Sao_Paulo')::date - 35 + 7 * k)::timestamp + make_interval(hours => hh)) at time zone 'America/Sao_Paulo' as s
            from generate_series(0, 4) k, (values (9), (10)) v(hh)) x`, [TENANT, RES, SVC]);
  });

  it("1 · o worker roda o motor uma vez no dia; a Home recebe até 3, com período, número e denominador", async () => {
    await runJobs();
    const again = (await runJobs()) as unknown as { insights: { tenants: number } };
    expect(again.insights.tenants).toBe(0);
    const home = await ok(InsightListOutput, "growth-advice", "insight.list", { ...owner, body: { scope: "home" } });
    expect(home.insights.length).toBeGreaterThan(0);
    expect(home.insights.length).toBeLessThanOrEqual(3);
    const priorities = home.insights.map((i) => i.priority);
    expect([...priorities].sort((a, b) => b - a)).toEqual(priorities);
    for (const i of home.insights) {
      expect(i.state).toBe("open");
      expect(i.evidence.denominator).toBeGreaterThan(0);
      expect(i.evidence.period_start <= i.evidence.period_end).toBe(true);
      expect(JSON.stringify(i)).not.toMatch(/payload|customer_ids/);
    }
    const all = await ok(InsightListOutput, "growth-advice", "insight.list", { ...owner, body: {} });
    expect(all.rules).toHaveLength(9);
    expect(all.rules.find((r) => r.code === "waitlist_opening")).toMatchObject({ status: "insufficient", reason: "no_waitlist" });
    expect(all.run?.run_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("2 · Ver (abrir o Caixa) registra a decisão para o acompanhamento; Preparar (P05) cria proposta sem publicar", async () => {
    const all = await ok(InsightListOutput, "growth-advice", "insight.list", { ...owner, body: {} });
    const unch = all.insights.find((i) => i.rule_code === "uncharged_bookings")!;
    expect(unch.action).toMatchObject({ kind: "open", flow: "P07", route: "/app/caixa" });
    await fails("growth-advice", "insight.act", { ...owner, key: true, body: { insight_id: unch.id, expected_version: unch.version + 7 } }, "STALE_VERSION");
    const seen = await ok(InsightCommandOutput, "growth-advice", "insight.act", { ...owner, key: true, body: { insight_id: unch.id, expected_version: unch.version } });
    expect(seen.result).toMatchObject({ kind: "open", route: "/app/caixa", created: 0 });
    expect(seen.insight.state).toBe("acted");
    expect(seen.insight.decision).toMatchObject({ decision: "accepted", outcome: null });

    const idle = all.insights.find((i) => i.rule_code === "idle_slot")!;
    expect(idle.subject_key).toBe("wd2-14-16");
    expect(idle.action).toMatchObject({ kind: "proposal", flow: "P05", operation: "pricing.propose_rule" });
    const prep = await ok(InsightCommandOutput, "growth-advice", "insight.act", { ...owner, key: true, body: { insight_id: idle.id, expected_version: idle.version } });
    expect(prep.result).toMatchObject({ kind: "pricing_proposal", created: 1, route: "/app/precos" });
    const [p] = await sql("select status, windows from public.pricing_rule_proposals where tenant_id = $1", [TENANT]) as { status: string; windows: unknown }[];
    expect(p).toMatchObject({ status: "proposed", windows: [{ weekday: 2, local_start: "14:00", local_end: "16:00" }] });
    expect(await sql("select 1 from public.pricing_rules where tenant_id = $1", [TENANT])).toHaveLength(0);
    await fails("growth-advice", "insight.act", { ...owner, key: true, body: { insight_id: idle.id, expected_version: prep.insight.version } }, "POLICY_REJECTED", "state");
  });

  it("3 · Agora não silencia a regra por 30 dias; o resumo semanal sai por modelo fixo", async () => {
    const home = await ok(InsightListOutput, "growth-advice", "insight.list", { ...owner, body: { scope: "home" } });
    const first = home.insights[0]!;
    const s = await ok(InsightCommandOutput, "growth-advice", "insight.snooze", { ...owner, key: true, body: { insight_id: first.id, expected_version: first.version } });
    expect(s.insight.state).toBe("snoozed");
    expect(Date.parse(s.insight.quiet_until!) - Date.now()).toBeGreaterThan(29 * 86_400_000);
    const after = await ok(InsightListOutput, "growth-advice", "insight.list", { ...owner, body: { scope: "home" } });
    expect(after.insights.map((i) => i.id)).not.toContain(first.id);
    const d = await ok(DigestListOutput, "growth-advice", "digest.list", { ...owner, body: {} });
    expect(d.digests).toHaveLength(1);
    expect(d.digests[0]!.body).toMatch(/^Resumo da semana de \d{2}\/\d{2} a \d{2}\/\d{2}\./);
    expect(d.digests[0]!.body).toContain("Texto automático por modelo fixo");
  });

  it("SEC · outro dono não lê nem age", async () => {
    await fails("growth-advice", "insight.list", { as: U.ownerB, tenant: TENANT, body: { scope: "home" } }, "FORBIDDEN");
    await fails("growth-advice", "digest.list", { as: U.ownerB, tenant: TENANT, body: {} }, "FORBIDDEN");
  });
});
