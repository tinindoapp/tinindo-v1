// P22 pelos handlers com o banco real: meta por indicador do P18 (progresso = o indicador, com denominador) →
// sugestões só por regras sobre dado existente → decisão registrada e acompanhada pelo worker → conteúdo aprovado
// publicado só pelo escopo do perfil (P09): sem o campo `bio` é recusado; com ele, a projeção pública mostra o texto.
// SEC: outro dono.
import { afterAll, describe, expect, it } from "vitest";
import { AdviceDecideOutput, AdviceListOutput, ContentListOutput, ContentPublishOutput, GoalListOutput, GoalOutput, PublicProfile } from "@contracts";
import { fails, ok, pool, runJobs, sql, T, U } from "./harness.ts";

const owner = { as: U.ownerA, tenant: T.A };
type Jobs = { advice?: { followed_up: number } };
afterAll(() => pool.end());

describe("P22 · metas e conteúdo pelos handlers", () => {
  let goalId = "";
  let version = 1;

  it("1 · meta por indicador: progresso é o indicador com denominador; uma ativa por indicador e mês; versão", async () => {
    await runJobs();
    const g = await ok(GoalOutput, "growth-advice", "goal.save", { ...owner, key: true, body: { metric_key: "charge_coverage", target: 0.9, note: "Registrar toda cobrança" } });
    goalId = g.goal.id;
    version = g.goal.version;
    expect(g.goal).toMatchObject({ direction: "up", status: "active", label: "Atendimentos com cobrança registrada" });
    expect(["ok", "insufficient"]).toContain(g.goal.progress.status);
    if (g.goal.progress.status === "ok") expect(g.goal.progress.denominator).toBeGreaterThan(0);
    await fails("growth-advice", "goal.save", { ...owner, key: true, body: { metric_key: "charge_coverage", target: 0.8 } }, "POLICY_REJECTED", "goal");
    await fails("growth-advice", "goal.save", { ...owner, key: true, body: { goal_id: goalId, expected_version: 99, metric_key: "charge_coverage", target: 0.8 } }, "STALE_VERSION");
    const g2 = await ok(GoalOutput, "growth-advice", "goal.save", { ...owner, key: true, body: { goal_id: goalId, expected_version: version, metric_key: "charge_coverage", target: 0.95 } });
    expect(g2.goal).toMatchObject({ target: 0.95, version: version + 1 });
    version = g2.goal.version;
    const list = await ok(GoalListOutput, "growth-advice", "goal.list", { ...owner, body: {} });
    expect(list.goals.some((x) => x.id === goalId)).toBe(true);
    expect(list.metrics.map((m) => m.key)).toContain("occupancy");
    expect(Date.parse(list.month_end)).toBeGreaterThan(Date.parse(list.month_start));
  });

  it("2 · sugestões só com dado existente; decidir congela o indicador; o worker acompanha como variação observada", async () => {
    const a = await ok(AdviceListOutput, "growth-advice", "advice.list", { ...owner, body: {} });
    for (const s of a.suggestions) {
      expect(s.route.startsWith("/app/")).toBe(true);
      expect(JSON.stringify(s)).not.toMatch(/Ana|Marina|Carlos/);
    }
    await fails("growth-advice", "advice.decide", { ...owner, key: true, body: { rule_code: "regra_inventada", decision: "accepted" } }, "POLICY_REJECTED", "rule_code");
    if (a.suggestions.length > 0) {
      const s = a.suggestions[0]!;
      const d = await ok(AdviceDecideOutput, "growth-advice", "advice.decide", { ...owner, key: true, body: { rule_code: s.rule_code, decision: "accepted" } });
      expect(d.decision).toMatchObject({ rule_code: s.rule_code, decision: "accepted", outcome: null });
      await fails("growth-advice", "advice.decide", { ...owner, key: true, body: { rule_code: s.rule_code, decision: "dismissed" } }, "POLICY_REJECTED", "decided");
      await sql("update public.advice_decisions set follow_up_at = clock_timestamp() - interval '1 minute' where id = $1", [d.decision.id]);
      expect(((await runJobs()) as Jobs).advice?.followed_up).toBe(1);
      const after = await ok(AdviceListOutput, "growth-advice", "advice.list", { ...owner, body: {} });
      const dec = after.decisions.find((x) => x.id === d.decision.id)!;
      expect(["improved", "worsened", "unchanged", "insufficient"]).toContain(dec.outcome);
      expect(dec.metric_after).not.toBeNull();
    }
    expect(((await runJobs()) as Jobs).advice?.followed_up).toBe(0);
  });

  it("3 · conteúdo aprovado da profissão; publicar exige perfil publicado com o campo bio; a projeção pública mostra o texto", async () => {
    const c = await ok(ContentListOutput, "growth-advice", "content.list", { ...owner, body: {} });
    expect(c.profession).toBe("barber");
    expect(c.templates.every((t) => ["barber", "all"].includes(t.profession))).toBe(true);
    expect(c.templates.find((t) => t.code === "bio_barber_classico")?.preview).toContain("Barbearia Exemplo A");
    // Perfil deste roteiro: publicado só com área e nome → escopo não inclui a apresentação.
    await sql("delete from public.profile_contents where tenant_id = $1", [T.A]);
    await sql(`insert into public.public_profiles (tenant_id, slug, category, area, public_fields, published_at) values ($1, 'barbearia-exemplo-a', 'barber', 'Pinheiros', array['area','display_name'], now())
      on conflict (tenant_id) do update set public_fields = array['area','display_name'], published_at = now()`, [T.A]);
    await fails("growth-advice", "content.publish", { ...owner, key: true, body: { template_code: "bio_barber_classico" } }, "POLICY_REJECTED", "scope");
    await fails("growth-advice", "content.publish", { ...owner, key: true, body: { template_code: "bio_pt_resultado" } }, "POLICY_REJECTED", "profession");
    await sql("update public.public_profiles set public_fields = array['area','bio','display_name'] where tenant_id = $1", [T.A]);
    const p = await ok(ContentPublishOutput, "growth-advice", "content.publish", { ...owner, key: true, body: { template_code: "bio_barber_classico" } });
    expect(p.published).toMatchObject({ template_code: "bio_barber_classico", version: 1 });
    expect(p.published!.body).toContain("Barbearia Exemplo A");
    const profile = await ok(PublicProfile, "network", "public.profile", { as: null, method: "GET", query: { slug: "barbearia-exemplo-a" } });
    expect(profile.fields.bio).toBe(p.published!.body);
    const c2 = await ok(ContentListOutput, "growth-advice", "content.list", { ...owner, body: {} });
    expect(c2.scope).toEqual({ profile_published: true, bio_field: true });
    await fails("growth-advice", "content.unpublish", { ...owner, key: true, body: { expected_version: 9 } }, "STALE_VERSION");
    const u = await ok(ContentPublishOutput, "growth-advice", "content.unpublish", { ...owner, key: true, body: { expected_version: p.published!.version } });
    expect(u.published).toBeNull();
    const ev = await sql<{ n: number }>("select count(*)::int as n from public.outbox_events where event_type = 'content.published.v1' and aggregate_id = $1", [T.A]);
    expect(ev[0]!.n).toBeGreaterThanOrEqual(1);
    await runJobs();
  });

  it("SEC · outro dono não vê metas nem publica", async () => {
    await fails("growth-advice", "goal.list", { as: U.ownerB, tenant: T.A, body: {} }, "FORBIDDEN");
    await fails("growth-advice", "content.publish", { as: U.ownerB, tenant: T.A, key: true, body: { template_code: "bio_barber_classico" } }, "FORBIDDEN");
    await ok(GoalOutput, "growth-advice", "goal.archive", { ...owner, key: true, body: { goal_id: goalId, expected_version: version } });
  });
});
