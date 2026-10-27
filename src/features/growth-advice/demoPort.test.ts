import { beforeEach, describe, expect, it } from "vitest";
import { AdviceListOutput, ContentListOutput, GoalListOutput } from "@contracts";
import { demoMetrics, demoMonthToDate } from "../../lib/demo/dataset.ts";
import { createDemoPort, resetDemoState, setDemoBioField } from "./demoPort.ts";

/** Faltas do mês até ontem na base de exemplo única (as mesmas do Resultado em "Este mês"). */
const NO_SHOW = demoMetrics(demoMonthToDate()).metrics.find((m) => m.key === "no_show")!;

const code = (p: Promise<unknown>) => p.then(() => "ok", (e: { code: string; field?: string }) => `${e.code}/${e.field ?? "-"}`);

describe("demonstração de Metas e conteúdo (mesmas regras do banco)", () => {
  beforeEach(() => resetDemoState());

  it("meta: progresso é o indicador com denominador; insuficiente ≠ zero; uma ativa por indicador e mês; versão", async () => {
    const port = createDemoPort();
    const g = await port.saveGoal({ metric_key: "no_show", target: 0.1 }, "g1");
    expect(NO_SHOW.value).toBeGreaterThan(0.1);
    expect(g).toMatchObject({ direction: "down", progress: { value: NO_SHOW.value, denominator: NO_SHOW.denominator, attainment: +(0.1 / NO_SHOW.value!).toFixed(4), achieved: false } });
    const w = await port.saveGoal({ metric_key: "waitlist_acceptance", target: 0.5 }, "g2");
    expect(w.progress).toMatchObject({ status: "insufficient", value: null, attainment: null });
    expect(await code(port.saveGoal({ metric_key: "no_show", target: 0.2 }, "g3"))).toBe("POLICY_REJECTED/goal");
    expect(await code(port.saveGoal({ metric_key: "occupancy", target: 1.5 }, "g4"))).toBe("VALIDATION_ERROR/target");
    expect(await code(port.saveGoal({ goal_id: g.id, expected_version: 9, metric_key: "no_show", target: 0.05 }, "g5"))).toBe("STALE_VERSION/-");
    const g2 = await port.saveGoal({ goal_id: g.id, expected_version: 1, metric_key: "no_show", target: 0.05 }, "g6");
    expect(g2).toMatchObject({ target: 0.05, version: 2, progress: { attainment: +(0.05 / NO_SHOW.value!).toFixed(4) } });
    GoalListOutput.parse(await port.goals());
    expect((await port.archiveGoal(g2, "g7")).status).toBe("archived");
  });

  it("sugestões só com dado; decisão uma vez por mês; acompanhamento é variação observada; conteúdo só pelo escopo", async () => {
    const port = createDemoPort();
    const a = AdviceListOutput.parse(await port.advice());
    expect(a.suggestions.map((s) => s.rule_code)).toEqual(["no_show_reminders", "occupancy_campaign", "charge_coverage", "quote_recurrence", "profile_bio"]);
    expect(JSON.stringify(a)).not.toMatch(/caus|efeito/);
    await port.decide("no_show_reminders", "accepted", "d1");
    expect(await code(port.decide("no_show_reminders", "dismissed", "d2"))).toBe("POLICY_REJECTED/decided");
    expect(await code(port.decide("inventada", "accepted", "d3"))).toBe("POLICY_REJECTED/rule_code");
    expect(await port.followUp!()).toEqual({ followed_up: 1 });
    expect((await port.advice()).decisions[0]).toMatchObject({ outcome: "improved", metric_before: { value: NO_SHOW.value }, metric_after: { value: 0.1 } });
    const c = ContentListOutput.parse(await port.content());
    expect(c.templates.filter((t) => t.kind === "bio")).toHaveLength(3);
    expect(await code(port.publish("post_retorno", "p0"))).toBe("POLICY_REJECTED/kind");
    setDemoBioField(false);
    expect(await code(port.publish("bio_barber_classico", "p1"))).toBe("POLICY_REJECTED/scope");
    setDemoBioField(true);
    await port.publish("bio_barber_classico", "p2");
    expect((await port.content()).published).toMatchObject({ template_code: "bio_barber_classico", version: 1 });
    expect((await port.advice()).suggestions.some((s) => s.rule_code === "profile_bio")).toBe(false);
    await port.publish("bio_barber_familia", "p3");
    expect((await port.content()).published?.version).toBe(2);
    expect(await code(port.unpublish(1, "u1"))).toBe("STALE_VERSION/-");
    await port.unpublish(2, "u2");
    expect((await port.content()).published).toBeNull();
  });
});
