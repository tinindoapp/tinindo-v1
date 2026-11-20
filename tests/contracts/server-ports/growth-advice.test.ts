// Porta de servidor de Metas e sugestões contra o registro de contratos (ver harness.ts).
import { describe, expect, it } from "vitest";
import { createServerPort } from "../../../src/features/growth-advice/serverPort.ts";
import type { Goal, Insight } from "../../../src/features/growth-advice/port.ts";
import { exercisePort, TENANT, unusedOperations } from "./harness.ts";

const ID = "00000000-0000-4000-8000-0000000000a1";
const goal = { id: ID, version: 2 } as Goal;
const insight = { id: ID, version: 6 } as Insight;

// O gerador de exemplo não acerta as rotas `/app/…`: as respostas com sugestão ou insight vão à mão.
const ROUTE = "/app/precos";
const served = {
  id: ID,
  rule_code: "idle_slot",
  rule_title: "Horário ocioso",
  subject_key: "ter-14h",
  state: "acted",
  priority: 10,
  title: "Terça às 14h costuma ficar vazia",
  body: "3 de 4 terças sem atendimento às 14h.",
  evidence: { period_start: "2026-09-21", period_end: "2026-10-18", numerator: 3, denominator: 4 },
  action: { kind: "proposal", flow: "P05", label: "Preparar oferta", route: ROUTE, operation: "pricing.propose_rule" },
  first_seen_on: "2026-10-19",
  last_seen_on: "2026-10-20",
  valid_until: "2026-10-27T03:00:00Z",
  quiet_until: null,
  acted_at: "2026-10-20T12:00:00Z",
  result: { kind: "pricing_proposal", created: 1, skipped: 0, route: ROUTE },
  decision: null,
  version: 7,
};
// O mesmo vale para a meta: o período é sempre o dia 1º do mês.
const savedGoal = {
  id: ID,
  metric_key: "occupancy",
  label: "Ocupação",
  unit: "ratio",
  target: 0.7,
  direction: "up",
  period_start: "2026-10-01",
  note: null,
  status: "active",
  created_at: "2026-10-01T12:00:00Z",
  version: 3,
  progress: { value: 0.4, numerator: 40, denominator: 100, status: "ok", note: "", attainment: 0.57, achieved: false },
};
const goalList = { month_start: "2026-10-01T03:00:00Z", month_end: "2026-11-01T03:00:00Z", goals: [savedGoal], metrics: [] };
const advised = {
  suggestions: [{ rule_code: "fill_idle_slots", metric_key: "occupancy", title: "Preencha os horários vazios", text: "Ocupação de 40% no mês.", route: "/app/agenda", evidence: {} }],
  decisions: [],
};
const command = { insight: served, result: served.result };
const listed = {
  run: { run_date: "2026-10-20", finished_at: "2026-10-20T09:00:00Z" },
  insights: [served],
  rules: [{ code: "idle_slot", title: "Horário ocioso", flow: "P05", status: "fire", reason: null }],
};

describe("growth-advice · porta do servidor", () => {
  it("toda chamada bate com o registro de contratos", async () => {
    const calls = await exercisePort("growth-advice", (call) => createServerPort(call, TENANT), {
      goals: (p) => p.goals(),
      saveGoal: (p, key) => p.saveGoal({ goal_id: null, expected_version: null, metric_key: "occupancy", target: 0.7, period_start: "2026-10-01", note: null }, key),
      archiveGoal: (p, key) => p.archiveGoal(goal, key),
      advice: (p) => p.advice(),
      decide: (p, key) => p.decide("fill_idle_slots", "accepted", key),
      content: (p) => p.content(),
      publish: (p, key) => p.publish("bio_barber_01", key),
      unpublish: (p, key) => p.unpublish(3, key),
      insights: async (p) => {
        await p.insights("home");
        await p.insights("all");
      },
      snoozeInsight: (p, key) => p.snoozeInsight(insight, key),
      actInsight: (p, key) => p.actInsight(insight, key),
      digests: (p) => p.digests(),
    }, { responses: { "goal.list": goalList, "goal.save": { goal: savedGoal }, "goal.archive": { goal: savedGoal }, "advice.list": advised, "insight.list": listed, "insight.snooze": command, "insight.act": command } });

    expect(calls.archiveGoal![0]!.body).toEqual({ goal_id: ID, expected_version: 2 });
    expect(calls.unpublish![0]!.body).toEqual({ expected_version: 3 });
    expect(calls.insights!.map((c) => c.body)).toEqual([{ scope: "home" }, { scope: "all" }]);
    // "Agora não" e "Preparar" mandam o mesmo corpo para operações diferentes.
    expect(calls.snoozeInsight![0]).toMatchObject({ operation: "insight.snooze", body: { insight_id: ID, expected_version: 6 } });
    expect(calls.actInsight![0]).toMatchObject({ operation: "insight.act", body: { insight_id: ID, expected_version: 6 } });
    // A tela de Metas e sugestões alcança todo o módulo.
    expect(unusedOperations("growth-advice", calls)).toEqual([]);
  });
});
