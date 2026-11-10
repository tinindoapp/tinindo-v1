import { describe, expect, it, vi } from "vitest";
import { ErrorEnvelope } from "../_shared/contracts/index.ts";
import { FX } from "../_shared/contracts/fixtures.ts";
import { createGrowthAdviceHandler, type GrowthAdviceDeps } from "./handler.ts";

const setup = (rpc: GrowthAdviceDeps["rpc"]) => createGrowthAdviceHandler({ rpc, allowedOrigins: [] });
const post = (op: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://edge/functions/v1/growth-advice/${op}`, { method: "POST", headers, body: JSON.stringify(body) });
const owner = { Authorization: "Bearer jwt", "X-Tinindo-Tenant": FX.tenants.A };
const key = { ...owner, "Idempotency-Key": "chave-metas-0000000001" };
const goal = { id: FX.tenants.B, metric_key: "no_show", label: "Faltas", unit: "ratio", target: 0.1, direction: "down", period_start: "2026-10-01", note: null, status: "active",
  created_at: "2026-10-22T12:00:00Z", version: 1, progress: { value: 0.3, numerator: 3, denominator: 10, status: "ok", note: "x", attainment: 0.3333, achieved: false } };

describe("Edge Function growth-advice", () => {
  it("meta é comando: exige chave; indicador fora da lista e mês inválido caem antes do banco; padrões nulos", async () => {
    const rpc = vi.fn(async () => ({ data: { status_code: 201, body: { goal } }, error: null }));
    const noKey = await setup(rpc)(post("goal.save", { metric_key: "no_show", target: 0.1 }, owner));
    expect(ErrorEnvelope.parse(await noKey.json()).error.field).toBe("idempotency_key");
    expect((await setup(rpc)(post("goal.save", { metric_key: "human_minutes", target: 1 }, key))).status).toBe(400);
    expect((await setup(rpc)(post("goal.save", { metric_key: "no_show", target: 0.1, period_start: "2026-10-15" }, key))).status).toBe(400);
    expect((await setup(rpc)(post("goal.save", { metric_key: "no_show", target: 0.1 }, key))).status).toBe(201);
    expect(rpc).toHaveBeenCalledWith("jwt", "goal_save", expect.objectContaining({ p_goal_id: null, p_expected_version: null, p_metric_key: "no_show", p_target: 0.1, p_period_start: null, p_note: null }));
  });

  it("sugestões: resposta com rota fora de /app/ ou veredito inventado vira 500; decisão só aceita/dispensa", async () => {
    const bad = vi.fn(async () => ({ data: { suggestions: [{ rule_code: "x_rule", metric_key: null, title: "t", text: "t", route: "https://fora", evidence: {} }], decisions: [] }, error: null }));
    expect((await setup(bad)(post("advice.list", {}, owner))).status).toBe(500);
    const causal = vi.fn(async () => ({ data: { suggestions: [], decisions: [{ id: FX.tenants.B, rule_code: "x_rule", metric_key: "no_show", decision: "accepted", evidence: {}, metric_before: null, metric_after: null, outcome: "caused_improvement", decided_at: "2026-10-22T12:00:00Z", follow_up_at: "2026-11-21T12:00:00Z" }] }, error: null }));
    expect((await setup(causal)(post("advice.list", {}, owner))).status).toBe(500);
    const rpc = vi.fn(async () => ({ data: { status_code: 201, body: {} }, error: null }));
    expect((await setup(rpc)(post("advice.decide", { rule_code: "no_show_reminders", decision: "maybe" }, key))).status).toBe(400);
  });

  it("publicar conteúdo: erro de escopo do banco mapeado (422, campo scope); despublicar exige versão", async () => {
    const denied = vi.fn(async () => ({ data: null, error: { code: "PT422", message: "POLICY_REJECTED", hint: "scope" } }));
    const res = await setup(denied)(post("content.publish", { template_code: "bio_barber_classico" }, key));
    expect(res.status).toBe(422);
    expect(ErrorEnvelope.parse(await res.json()).error).toMatchObject({ code: "POLICY_REJECTED", field: "scope" });
    expect((await setup(denied)(post("content.unpublish", {}, key))).status).toBe(400);
    expect(denied).toHaveBeenCalledWith("jwt", "content_publish", expect.objectContaining({ p_template_code: "bio_barber_classico" }));
  });

  it("insights (P45): lista com escopo padrão `all`; Preparar/Agora não são comandos com versão; ação fora de /app/ ou sem denominador vira 500", async () => {
    const rpc = vi.fn(async () => ({ data: { run: null, insights: [], rules: [] }, error: null }));
    expect((await setup(rpc)(post("insight.list", {}, owner))).status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("jwt", "insight_list", { p_tenant_id: FX.tenants.A, p_scope: "all" });
    expect((await setup(rpc)(post("insight.list", { scope: "tudo" }, owner))).status).toBe(400);
    const noKey = await setup(rpc)(post("insight.act", { insight_id: FX.tenants.B, expected_version: 1 }, owner));
    expect(ErrorEnvelope.parse(await noKey.json()).error.field).toBe("idempotency_key");
    expect((await setup(rpc)(post("insight.snooze", { insight_id: FX.tenants.B }, key))).status).toBe(400);
    const insight = { id: FX.tenants.B, rule_code: "uncharged_bookings", rule_title: "Atendimentos sem cobrança", subject_key: "last30", state: "open", priority: 90,
      title: "t", body: "b", evidence: { period_start: "2026-10-04", period_end: "2026-11-03", numerator: 0, denominator: 5 },
      action: { kind: "open", flow: "P07", label: "Abrir o Caixa", route: "https://fora" }, first_seen_on: "2026-11-03", last_seen_on: "2026-11-03",
      valid_until: "2026-11-05T12:00:00Z", quiet_until: null, acted_at: null, result: null, decision: null, version: 1 };
    const outside = vi.fn(async () => ({ data: { run: null, insights: [insight], rules: [] }, error: null }));
    expect((await setup(outside)(post("insight.list", {}, owner))).status).toBe(500);
    const noDen = vi.fn(async () => ({ data: { run: null, insights: [{ ...insight, action: { ...insight.action, route: "/app/caixa" }, evidence: { period_start: "2026-10-04", period_end: "2026-11-03", numerator: 0 } }], rules: [] }, error: null }));
    expect((await setup(noDen)(post("insight.list", {}, owner))).status).toBe(500);
    const stale = vi.fn(async () => ({ data: null, error: { code: "PT422", message: "POLICY_REJECTED", hint: "stale" } }));
    const res = await setup(stale)(post("insight.act", { insight_id: FX.tenants.B, expected_version: 2 }, key));
    expect(ErrorEnvelope.parse(await res.json()).error).toMatchObject({ code: "POLICY_REJECTED", field: "stale" });
    expect(stale).toHaveBeenCalledWith("jwt", "insight_act", expect.objectContaining({ p_insight_id: FX.tenants.B, p_expected_version: 2 }));
  });
});

