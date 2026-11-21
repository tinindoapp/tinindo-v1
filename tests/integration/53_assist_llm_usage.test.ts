// Assistente parte 2 · T11: custo da camada de linguagem por negócio, com o banco real. A função `agent` é montada
// aqui com um provedor falso (o harness monta sem `llm`, como `LLM_PROVIDER=none`), reaproveitando o `rpc` do harness:
// mesmas RPCs, mesmos papéis, mesma RLS. Confere: uso gravado no negócio e no mês do fuso dele, soma por tarefa, custo
// sem preço que não zera a soma, teto estourado = resposta igual à de `none` sem chamar o modelo, `none` sem RPC de
// uso, outro negócio sem acesso.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AgentAnswer, AgentDraftOutput, IDEMPOTENCY_HEADER, TENANT_HEADER } from "@contracts";
import { createAgentHandler } from "../../supabase/functions/agent/handler.ts";
import { createLlm } from "../../supabase/functions/_shared/llm/client.ts";
import type { Adapter, AdapterRequest, LlmTask } from "../../supabase/functions/_shared/llm/types.ts";
import { call, newKey, pool, rpc, sql, T, U } from "./harness.ts";

const A = T.A;
const PEDIDO = "zum zum zum, e o dia, como fica?";
const AGENDA_HOJE = {
  intent: "agenda", customer: null, service: null, date: null, time: null, new_date: null, new_time: null, end_time: null,
  period: "today", day_part: null, weekday: null, percent: null, source: null,
};

/** Provedor falso: devolve a leitura certa para cada tarefa e o uso informado; guarda o que recebeu. */
function fakeAgent(model: string, usage = { input_tokens: 700, output_tokens: 100 }) {
  const sent: AdapterRequest[] = [];
  const adapter: Adapter = {
    provider: "anthropic",
    call: async (req) => {
      sent.push(req);
      const out = req.schemaName === "tinindo_draft" ? { text: req.input.replace("Oi", "Olá") } : AGENDA_HOJE;
      return { text: JSON.stringify(out), refusal: false, truncated: false, usage };
    },
  };
  const models = Object.fromEntries((["intent", "setup", "draft", "explain"] as LlmTask[]).map((t) => [t, model])) as Record<LlmTask, string>;
  const log: unknown[] = [];
  const handler = createAgentHandler({
    allowedOrigins: [], rpc: (token, fn, args) => rpc(token, fn, args), llm: createLlm({ adapter, models }, null), log: (e) => log.push(e),
  });
  return { sent, log, handler };
}

async function post(handler: (r: Request) => Promise<Response>, op: string, body: unknown, as: string = U.ownerA, tenant: string = A) {
  const res = await handler(new Request(`http://edge/functions/v1/agent/${op}`, {
    method: "POST", body: JSON.stringify(body),
    headers: { Authorization: `Bearer ${as}`, [TENANT_HEADER]: tenant, [IDEMPOTENCY_HEADER]: newKey(), "Content-Type": "application/json" },
  }));
  return { status: res.status, json: (await res.json()) as { data?: unknown; error?: { code: string } } };
}

type Row = { task: string; month: string; calls: number; input_tokens: number; output_tokens: number; cost_usd: number; unpriced_calls: number };
const usage = (tenant: string) => sql<Row>(
  `select task, month::text as month, calls, input_tokens, output_tokens, cost_usd, unpriced_calls
   from public.agent_llm_usage where tenant_id = $1 order by task`, [tenant]);
const thisMonth = async (tenant: string) => (await sql<{ m: string }>(
  "select date_trunc('month', now() at time zone t.timezone)::date::text as m from public.tenants t where t.id = $1", [tenant]))[0]!.m;

beforeAll(async () => {
  await sql("delete from public.agent_llm_usage where tenant_id in ($1, $2)", [T.A, T.B]);
});
afterAll(async () => {
  await sql("delete from public.agent_llm_usage where tenant_id in ($1, $2)", [T.A, T.B]);
  await sql("update public.agent_quotas set llm_monthly_tokens = 400000 where tenant_id in ($1, $2)", [T.A, T.B]);
  await pool.end();
});

describe("T11 · uso do modelo por negócio, com o banco real", () => {
  it("pedido livre com provedor: o modelo lê, o uso entra no negócio e no mês do fuso dele", async () => {
    const f = fakeAgent("claude-haiku-5-5");
    const r = await post(f.handler, "agent.ask", { text: PEDIDO });
    expect(r.status).toBe(200);
    expect(AgentAnswer.parse(r.json.data).text).not.toMatch(/Não entendi/);
    expect(f.sent).toHaveLength(1);
    expect(await usage(A)).toEqual([
      { task: "intent", month: await thisMonth(A), calls: 1, input_tokens: 700, output_tokens: 100, cost_usd: 0.00012, unpriced_calls: 0 },
    ]);
    // Log técnico da função: sem negócio, sem texto.
    expect(JSON.stringify(f.log)).not.toContain(A);
    expect(JSON.stringify(f.log)).not.toContain("zum");
  });

  it("segunda pergunta soma na mesma linha; modelo sem preço conta em unpriced_calls e não zera o custo", async () => {
    await post(fakeAgent("claude-haiku-5-5").handler, "agent.ask", { text: PEDIDO });
    await post(fakeAgent("modelo-sem-preco", { input_tokens: 300, output_tokens: 20 }).handler, "agent.ask", { text: PEDIDO });
    expect((await usage(A))[0]).toMatchObject({ task: "intent", calls: 3, input_tokens: 1700, output_tokens: 220, cost_usd: 0.00024, unpriced_calls: 1 });
  });

  it("redação conta como tarefa draft, em linha própria", async () => {
    const f = fakeAgent("claude-haiku-5-5", { input_tokens: 400, output_tokens: 200 });
    const r = await post(f.handler, "agent.draft", { kind: "message", text: "Oi, tudo bem? Te espero quinta." });
    expect(AgentDraftOutput.parse(r.json.data)).toEqual({ available: true, suggestion: "Olá, tudo bem? Te espero quinta." });
    const rows = await usage(A);
    expect(rows.map((x) => x.task)).toEqual(["draft", "intent"]);
    expect(rows[0]).toMatchObject({ calls: 1, input_tokens: 400, output_tokens: 200, cost_usd: 0.00014, unpriced_calls: 0 });
  });

  it("teto consultado pelo dono reflete o uso do mês", async () => {
    const a = await rpc(U.ownerA, "agent_llm_allowance", { p_tenant_id: A });
    expect(a.data).toEqual({ allowed: true, used_tokens: 2520, limit_tokens: 400000 });
  });

  it("teto estourado: o modelo não é chamado, a resposta é a mesma de LLM_PROVIDER=none e nada é gravado", async () => {
    await sql("update public.agent_quotas set llm_monthly_tokens = 2520 where tenant_id = $1", [A]);
    const before = await usage(A);
    const f = fakeAgent("claude-haiku-5-5");
    const over = await post(f.handler, "agent.ask", { text: PEDIDO });
    expect(over.status).toBe(200);
    expect(f.sent).toHaveLength(0);
    const none = await call("agent", "agent.ask", { as: U.ownerA, tenant: A, key: true, body: { text: PEDIDO } });
    expect(AgentAnswer.parse(over.json.data)).toEqual(AgentAnswer.parse(none.data));
    // Redação acima do teto: igual a sem provedor.
    const d = await post(f.handler, "agent.draft", { kind: "message", text: "Oi, tudo bem?" });
    expect(AgentDraftOutput.parse(d.json.data)).toEqual({ available: false, suggestion: null });
    expect(f.sent).toHaveLength(0);
    expect(await usage(A)).toEqual(before);
    const a = await rpc(U.ownerA, "agent_llm_allowance", { p_tenant_id: A });
    expect(a.data).toMatchObject({ allowed: false, used_tokens: 2520, limit_tokens: 2520 });
    await sql("update public.agent_quotas set llm_monthly_tokens = 400000 where tenant_id = $1", [A]);
  });

  it("LLM_PROVIDER=none (o handler do harness): pedido que o motor não entende não grava uso", async () => {
    const before = await usage(A);
    const r = await call("agent", "agent.ask", { as: U.ownerA, tenant: A, key: true, body: { text: PEDIDO } });
    expect(r.status).toBe(200);
    expect(await usage(A)).toEqual(before);
  });

  it("outro negócio não grava nem consulta o uso de A; B tem a própria conta", async () => {
    const rec = await rpc(U.ownerB, "agent_llm_record", { p_tenant_id: A, p_task: "intent", p_input_tokens: 1, p_output_tokens: 1, p_cost_usd: 0 });
    expect(rec.error?.code).toBe("PT403");
    const allow = await rpc(U.ownerB, "agent_llm_allowance", { p_tenant_id: A });
    expect(allow.error?.code).toBe("PT403");
    // Pela função: B perguntando no negócio A é barrado no portão, antes do modelo.
    const f = fakeAgent("claude-haiku-5-5");
    const r = await post(f.handler, "agent.ask", { text: PEDIDO }, U.ownerB, A);
    expect(r.status).toBe(403);
    expect(f.sent).toHaveLength(0);
    // B no próprio negócio: linha própria, A intacto.
    const before = await usage(A);
    await post(f.handler, "agent.ask", { text: PEDIDO }, U.ownerB, T.B);
    expect((await usage(T.B))[0]).toMatchObject({ task: "intent", calls: 1 });
    expect(await usage(A)).toEqual(before);
  });

  it("anon não chama as RPCs de uso", async () => {
    const r = await rpc(null, "agent_llm_record", { p_tenant_id: A, p_task: "intent", p_input_tokens: 1, p_output_tokens: 1, p_cost_usd: 0 });
    expect(r.error?.code).toBe("42501");
  });
});
