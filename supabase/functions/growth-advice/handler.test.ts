import { describe, expect, it, vi } from "vitest";
import { ErrorEnvelope } from "../_shared/contracts/index.ts";
import { FX } from "../_shared/contracts/fixtures.ts";
import type { Llm } from "../_shared/llm/types.ts";
import { InsightExplainOutput } from "../_shared/domain/agent/insight-explain.ts";
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

  describe("insight.explain (\"Por quê?\", T3): frase do modelo guardada por versão; frase fixa sem modelo, sem franquia ou com número inventado", () => {
    const INSIGHT = FX.tenants.B;
    const evidence = { period_start: "2026-08-21", period_end: "2026-10-20", numerator: 5, denominator: 12, weekday: 3 };
    const FIXED = "De 21/08 a 20/10, 5 de 12 atendimentos de quarta tiveram falta. Um lembrete no dia anterior costuma ajudar quem esquece. Ajuste os lembretes em Relacionamento.";
    const MODEL = "De 21/08 a 20/10, 5 de 12 atendimentos de quarta tiveram falta: um lembrete no dia anterior pode ajudar.";
    /** Banco de mentira: uma frase por versão, como a tabela insight_explanations (on conflict do nothing). */
    function world(opts: { version?: number; quota?: boolean; role?: string } = {}) {
      const stored = new Map<number, string>();
      let version = opts.version ?? 3;
      const rpc = vi.fn<GrowthAdviceDeps["rpc"]>(async (_t, fn, a) => {
        switch (fn) {
          case "insight_explanation_get":
            return { data: { insight_id: INSIGHT, rule_code: "no_show_concentration", rule_title: "Faltas concentradas", state: "open", version, evidence, text: stored.get(version) ?? null }, error: null };
          case "agent_run_start":
            return opts.quota === false
              ? { data: null, error: { code: "PT429", message: "QUOTA_EXCEEDED" } }
              : { data: { run_id: FX.tenants.A, role: opts.role ?? "owner", tenant_name: "x", timezone: "America/Sao_Paulo" }, error: null };
          case "insight_explanation_save": {
            if (a.p_version !== version) return { data: null, error: { code: "PT409", message: "STALE_VERSION", hint: "version" } };
            const saved = !stored.has(version);
            if (saved) stored.set(version, String(a.p_text));
            return { data: { insight_id: INSIGHT, version, saved, text: stored.get(version) }, error: null };
          }
          default:
            return { data: null, error: { code: "PT403", message: "FORBIDDEN" } };
        }
      });
      return { rpc, stored, bump: () => { version += 1; } };
    }
    const llmSaying = (sentence: string | null) => {
      const extract = vi.fn(async (_req: { task: string; input: string }): Promise<unknown> => (sentence === null ? null : { sentence }));
      const llm: Llm = { enabled: true, extract: extract as Llm["extract"] };
      return Object.assign(llm, { extract });
    };
    const explain = (h: ReturnType<typeof createGrowthAdviceHandler>, body: unknown = { insight_id: INSIGHT }) =>
      h(post("insight.explain", body, owner)).then(async (r) => ({ status: r.status, body: InsightExplainOutput.parse(((await r.json()) as { data: unknown }).data) }));
    const calls = (rpc: ReturnType<typeof world>["rpc"], fn: string) => rpc.mock.calls.filter((c) => c[1] === fn).length;

    it("abre a primeira vez: portão, modelo e gravação; abre de novo a mesma versão: devolve a guardada sem modelo nem débito", async () => {
      const w = world();
      const llm = llmSaying(MODEL);
      const log = vi.fn();
      const h = createGrowthAdviceHandler({ rpc: w.rpc, allowedOrigins: [], llm, log });
      const first = await explain(h);
      expect(first).toEqual({ status: 200, body: { insight_id: INSIGHT, version: 3, text: MODEL, source: "assistant" } });
      expect(w.rpc).toHaveBeenCalledWith("jwt", "insight_explanation_get", { p_tenant_id: FX.tenants.A, p_insight_id: INSIGHT });
      expect(w.rpc).toHaveBeenCalledWith("jwt", "agent_run_start", { p_tenant_id: FX.tenants.A, p_idem_key: `explain-${INSIGHT}-v3` });
      expect(w.rpc).toHaveBeenCalledWith("jwt", "insight_explanation_save", { p_tenant_id: FX.tenants.A, p_insight_id: INSIGHT, p_version: 3, p_text: MODEL });
      // Para o modelo: título da regra e números da evidência; nada do negócio, do token ou do id.
      const req = llm.extract.mock.calls[0]![0] as { task: string; input: string };
      expect(req.task).toBe("explain");
      expect(JSON.parse(req.input)).toEqual({ titulo: "Faltas concentradas", evidencia: { periodo: "de 21/08 a 20/10", numero: 5, de: 12, dia_da_semana: "quarta" } });
      expect(req.input).not.toContain(INSIGHT);
      expect(req.input).not.toContain(FX.tenants.A);

      const again = await explain(h);
      expect(again.body).toEqual(first.body);
      expect(llm.extract).toHaveBeenCalledTimes(1);
      expect(calls(w.rpc, "agent_run_start")).toBe(1);
      expect(calls(w.rpc, "insight_explanation_save")).toBe(1);
      // Log sem PII: sem negócio, evidência nem frase.
      const entry = JSON.stringify(log.mock.calls.at(-1)![0]);
      expect(entry).toContain('"route":"insight.explain"');
      expect(entry).toContain('"cached":true');
      for (const raw of [FX.tenants.A, MODEL, "21/08"]) expect(entry).not.toContain(raw);
    });

    it("versão nova do insight (o motor recalculou): gera de novo", async () => {
      const w = world();
      const llm = llmSaying(MODEL);
      const h = createGrowthAdviceHandler({ rpc: w.rpc, allowedOrigins: [], llm });
      expect((await explain(h)).body.version).toBe(3);
      w.bump();
      const next = await explain(h);
      expect(next.body).toMatchObject({ version: 4, source: "assistant" });
      expect(llm.extract).toHaveBeenCalledTimes(2);
      expect(w.rpc).toHaveBeenCalledWith("jwt", "agent_run_start", { p_tenant_id: FX.tenants.A, p_idem_key: `explain-${INSIGHT}-v4` });
      expect([...w.stored.keys()]).toEqual([3, 4]);
    });

    it("LLM_PROVIDER=none: frase fixa, sem portão, sem franquia e sem gravar", async () => {
      const w = world();
      const res = await explain(createGrowthAdviceHandler({ rpc: w.rpc, allowedOrigins: [] }));
      expect(res).toEqual({ status: 200, body: { insight_id: INSIGHT, version: 3, text: FIXED, source: "fixed" } });
      expect(w.rpc.mock.calls.map((c) => c[1])).toEqual(["insight_explanation_get"]);
    });

    it("frase do modelo com número que não está na evidência (ou exclamação): frase fixa, nada gravado", async () => {
      for (const sentence of ["De 21/08 a 20/10, 7 de 12 atendimentos de quarta tiveram falta.", "Faltas na quarta: ligue os lembretes!"]) {
        const w = world();
        const res = await explain(createGrowthAdviceHandler({ rpc: w.rpc, allowedOrigins: [], llm: llmSaying(sentence) }));
        expect(res.body).toMatchObject({ text: FIXED, source: "fixed" });
        expect(calls(w.rpc, "insight_explanation_save")).toBe(0);
      }
    });

    it("franquia esgotada, papel que não é dono ou provedor fora do ar: frase fixa, nunca erro", async () => {
      const exhausted = world({ quota: false });
      const llm = llmSaying(MODEL);
      const r1 = await explain(createGrowthAdviceHandler({ rpc: exhausted.rpc, allowedOrigins: [], llm }));
      expect(r1).toMatchObject({ status: 200, body: { text: FIXED, source: "fixed" } });
      expect(llm.extract).not.toHaveBeenCalled();
      const staff = world({ role: "staff" });
      expect((await explain(createGrowthAdviceHandler({ rpc: staff.rpc, allowedOrigins: [], llm }))).body.source).toBe("fixed");
      const down: Llm = { enabled: true, extract: vi.fn(async () => { throw new Error("rede"); }) };
      const r3 = await explain(createGrowthAdviceHandler({ rpc: world().rpc, allowedOrigins: [], llm: down }));
      expect(r3).toMatchObject({ status: 200, body: { source: "fixed" } });
    });

    it("sem acesso ao insight (outro negócio, módulo desligado) é erro do banco; id inválido cai antes do banco", async () => {
      const denied = vi.fn<GrowthAdviceDeps["rpc"]>(async () => ({ data: null, error: { code: "PT403", message: "FORBIDDEN", hint: "module_disabled" } }));
      const h = createGrowthAdviceHandler({ rpc: denied, allowedOrigins: [], llm: llmSaying(MODEL) });
      const res = await h(post("insight.explain", { insight_id: INSIGHT }, owner));
      expect(res.status).toBe(403);
      expect(denied.mock.calls.map((c) => c[1])).toEqual(["insight_explanation_get"]);
      expect((await h(post("insight.explain", { insight_id: "x" }, owner))).status).toBe(400);
      expect((await h(post("insight.explain", { insight_id: INSIGHT }, { Authorization: "Bearer jwt" }))).status).toBe(400);
      expect((await h(post("insight.explain", { insight_id: INSIGHT }))).status).toBe(401);
      expect(denied).toHaveBeenCalledTimes(1);
    });
  });
});
