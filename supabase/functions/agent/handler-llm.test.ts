// P46 · função `agent` com a camada de linguagem: pedido livre vira a mesma proposta pendente do motor; provedor fora
// do ar devolve a resposta determinística; agent.draft passa pelo mesmo portão e franquia e nunca grava nada.
import { describe, expect, it, vi } from "vitest";
import { AgentAnswer, AgentDraftOutput, ErrorEnvelope } from "../_shared/contracts/index.ts";
import { FX } from "../_shared/contracts/fixtures.ts";
import type { RpcResult } from "../_shared/http/rpc-handler.ts";
import { createLlm } from "../_shared/llm/client.ts";
import type { Adapter, AdapterRequest, LlmTask } from "../_shared/llm/types.ts";
import { createAgentHandler } from "./handler.ts";

const NOW = new Date("2026-10-20T12:00:00Z");
const TENANT = FX.tenants.A;
const RUN = "e0000000-0000-4000-8000-000000000001";
const PROPOSAL = "e0000000-0000-4000-8000-000000000002";
const corte = {
  id: FX.services.corteA, name: "Corte", duration_min: 30, buffer_before_min: 0, buffer_after_min: 10,
  base_price_cents: 6000, min_price_cents: 4500, estimated_cost_cents: 1500, fee_bps: 500,
};
const maria = { id: "30000000-0000-4000-8000-0000000000a3", name: "Maria Exemplo Silva", declared_source: "referral" };
const directory = {
  services: [corte], customers: [maria], customers_total: 1, pricing_rules: [], cancellation: null,
  waitlist: { active: 0, offered: 0 }, as_of: "2026-10-20T12:00:00Z",
};
const agenda = (from: string) => {
  const date = from.slice(0, 10);
  return {
    resource_id: FX.resources.A, timezone: "America/Sao_Paulo", as_of: "2026-10-20T12:00:00Z", bookings: [],
    days: [{ date, open: [{ starts_at: `${date}T12:00:00Z`, ends_at: `${date}T22:00:00Z` }], blocks: [] }],
  };
};
const READING = {
  intent: "booking_create", customer: "cliente 1", service: "corte", date: "2026-10-22", time: "10:00", new_date: null, new_time: null,
  end_time: null, period: null, day_part: null, weekday: null, percent: null, source: null,
};
const models = Object.fromEntries((["intent", "setup", "draft", "explain"] as LlmTask[]).map((t) => [t, "claude-haiku-5-5"])) as Record<LlmTask, string>;

type Rpc = (token: string, fn: string, args: Record<string, unknown>) => Promise<RpcResult>;
interface WorldOpts {
  /** Resposta de agent_llm_allowance (T11). Padrão: abaixo do teto. */
  allowance?: RpcResult;
  /** Resposta de agent_llm_record. Padrão: gravado. */
  record?: RpcResult;
  /** Provedor de reserva que também responde com `reply`. */
  fallback?: boolean;
}
const UNDER = { data: { allowed: true, used_tokens: 1200, limit_tokens: 400000 }, error: null };
function world(reply: (req: AdapterRequest) => unknown, role: "owner" | "staff" = "owner", opts: WorldOpts = {}) {
  const rpc = vi.fn<Rpc>(async (_t, fn, a) => {
    switch (fn) {
      case "agent_llm_allowance": return opts.allowance ?? UNDER;
      case "agent_llm_record": return opts.record ?? { data: { calls: 1 }, error: null };
      case "agent_run_start": return { data: { run_id: RUN, role, tenant_name: "Barbearia Exemplo A", timezone: "America/Sao_Paulo" }, error: null };
      case "agent_directory": return { data: directory, error: null };
      case "agent_agenda_read": return { data: agenda(String(a.p_from)), error: null };
      case "agent_proposal_create": return { data: { status_code: 201, body: {
        proposal_id: PROPOSAL, tenant_id: TENANT, tool: a.p_tool, payload: a.p_payload, payload_hash: "f".repeat(64), policy_version: 1,
        version: 1, expires_at: "2026-10-20T12:30:00Z", approval_state: "pending", summary: a.p_summary,
      } }, error: null };
      default: return { data: null, error: { code: "PT403", message: "FORBIDDEN" } };
    }
  });
  const sent: AdapterRequest[] = [];
  const adapter: Adapter = {
    provider: "anthropic",
    call: (req) => {
      sent.push(req);
      const r = reply(req);
      if (r instanceof Error) return Promise.reject(r);
      return Promise.resolve({ text: JSON.stringify(r), refusal: false, truncated: false, usage: { input_tokens: 10, output_tokens: 5 } });
    },
  };
  const log = vi.fn();
  const llm = createLlm({ adapter, models }, opts.fallback ? { adapter: { ...adapter, provider: "openai" }, models } : null, { log });
  return { rpc, log, sent, handler: createAgentHandler({ rpc, allowedOrigins: [], log, llm, clock: { now: () => NOW } }) };
}
const post = (op: string, body: unknown) =>
  new Request(`http://edge/functions/v1/agent/${op}`, {
    method: "POST", body: JSON.stringify(body), headers: { Authorization: "Bearer jwt-do-dono", "X-Tinindo-Tenant": TENANT },
  });

describe("agent.ask com provedor ligado", () => {
  it("pedido livre → intenção do modelo → a MESMA proposta pendente do motor; nome do cliente não vai ao modelo", async () => {
    const w = world(() => READING);
    const res = await w.handler(post("agent.ask", { text: "bota a Maria Exemplo Silva pra cortar quinta 10 da manhã" }));
    expect(res.status).toBe(200);
    const body = AgentAnswer.parse((await res.json()).data);
    expect(body.state).toBe("pending_approval");
    expect(body.proposal?.tool).toBe("booking.create");
    expect(body.proposal?.payload).toMatchObject({ customer_id: maria.id, service_id: corte.id, starts_at: "2026-10-22T13:00:00Z" });
    expect(body.proposal?.approval_state).toBe("pending");
    expect(w.sent).toHaveLength(1);
    expect(w.sent[0]!.input).toContain("cliente 1");
    expect(w.sent[0]!.input).not.toMatch(/maria/i);
    // Log da função: intenção e uso do modelo, sem texto.
    const fnLog = w.log.mock.calls.map((c) => c[0]).find((e) => e.fn === "agent");
    expect(fnLog).toMatchObject({ intent: "booking_create", llm: "used" });
    expect(JSON.stringify(w.log.mock.calls)).not.toMatch(/cortar|Maria/);
  });

  it("pedido que o motor entende não chama o modelo", async () => {
    const w = world(() => READING);
    await w.handler(post("agent.ask", { text: "o que tenho amanhã?" }));
    expect(w.sent).toHaveLength(0);
  });

  it("provedor fora do ar → resposta determinística (200), nunca erro", async () => {
    const w = world(() => new Error("caiu"));
    const res = await w.handler(post("agent.ask", { text: "bota a Maria pra cortar quinta 10 da manhã" }));
    expect(res.status).toBe(200);
    const body = AgentAnswer.parse((await res.json()).data);
    expect(body.proposal).toBeNull();
    expect(body.text).toMatch(/Não entendi/);
  });
});

describe("agent.draft", () => {
  it("sem provedor: available false, sem débito de franquia nem leitura", async () => {
    const rpc = vi.fn<Rpc>();
    const handler = createAgentHandler({ rpc, allowedOrigins: [], clock: { now: () => NOW } });
    const res = await handler(post("agent.draft", { kind: "message", text: "Oi, tudo bem?" }));
    expect(res.status).toBe(200);
    expect(AgentDraftOutput.parse((await res.json()).data)).toEqual({ available: false, suggestion: null });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("com provedor: portão → diretório → nomes como rótulo → sugestão com o nome de volta; nada gravado", async () => {
    const w = world((req) => ({ text: req.input.replace("Oi", "Olá").replace("até", "te espero") }));
    const res = await w.handler(post("agent.draft", { kind: "message", tone: "proximo", text: "Oi Maria Exemplo Silva, até quinta 10h. Tel (11) 98765-4321" }));
    expect(res.status).toBe(200);
    const out = AgentDraftOutput.parse((await res.json()).data);
    expect(out.available).toBe(true);
    expect(out.suggestion).toBe("Olá Maria Exemplo Silva, te espero quinta 10h. Tel [telefone]");
    expect(w.sent[0]!.input).not.toMatch(/maria|98765/i);
    // Nada do texto é gravado: só o teto do mês e o uso (números) além do portão e do diretório.
    expect(w.rpc.mock.calls.map((c) => c[1])).toEqual(["agent_llm_allowance", "agent_run_start", "agent_directory", "agent_llm_record"]);
  });

  it("sugestão que inventa número é descartada (suggestion null)", async () => {
    const w = world(() => ({ text: "Olá! 30% de desconto quinta." }));
    const res = await w.handler(post("agent.draft", { kind: "campaign", text: "Volta pra cortar com a gente quinta." }));
    expect(AgentDraftOutput.parse((await res.json()).data)).toEqual({ available: true, suggestion: null });
  });

  it("equipe não redige pelo assistente (403)", async () => {
    const w = world(() => ({ text: "x" }), "staff");
    const res = await w.handler(post("agent.draft", { kind: "bio", text: "Sou barbeiro há 10 anos." }));
    expect(res.status).toBe(403);
    expect(ErrorEnvelope.parse(await res.json()).error.code).toBe("FORBIDDEN");
    expect(w.sent).toHaveLength(0);
  });

  it("entrada inválida: 400 com o campo", async () => {
    const w = world(() => ({ text: "x" }));
    const res = await w.handler(post("agent.draft", { kind: "sms", text: "x" }));
    expect(res.status).toBe(400);
    expect(ErrorEnvelope.parse(await res.json()).error.field).toBe("kind");
  });
});

// T11 · custo por negócio: teto do mês antes do modelo, uso gravado por tentativa, `none` sem nenhuma RPC de uso.
describe("uso do modelo por negócio (T11)", () => {
  const fns = (rpc: { mock: { calls: unknown[][] } }) => rpc.mock.calls.map((c) => String(c[1]));
  const records = (rpc: { mock: { calls: unknown[][] } }) =>
    rpc.mock.calls.filter((c) => c[1] === "agent_llm_record").map((c) => c[2]);
  const agentLog = (log: { mock: { calls: unknown[][] } }) =>
    log.mock.calls.map((c) => c[0] as Record<string, unknown>).find((e) => e.fn === "agent");
  const PEDIDO = { text: "bota a Maria Exemplo Silva pra cortar quinta 10 da manhã" };

  it("agent.ask: teto consultado antes do modelo e uso gravado no negócio do header, só números", async () => {
    const w = world(() => READING);
    const res = await w.handler(post("agent.ask", PEDIDO));
    expect(res.status).toBe(200);
    expect(w.sent).toHaveLength(1);
    const order = fns(w.rpc);
    expect(order.indexOf("agent_run_start")).toBeLessThan(order.indexOf("agent_llm_allowance"));
    expect(order.indexOf("agent_llm_allowance")).toBeLessThan(order.indexOf("agent_llm_record"));
    expect(records(w.rpc)).toEqual([{
      p_tenant_id: TENANT, p_task: "intent", p_input_tokens: 10, p_output_tokens: 5, p_cost_usd: 0.000004,
    }]);
    expect(agentLog(w.log)).toMatchObject({ llm: "used", llm_budget: "ok" });
    // O registro técnico continua sem negócio.
    for (const [e] of w.log.mock.calls) expect(JSON.stringify(e)).not.toContain(TENANT);
  });

  it("agent.ask: pedido que o motor entende não consulta o teto nem grava uso", async () => {
    const w = world(() => READING);
    await w.handler(post("agent.ask", { text: "o que tenho amanhã?" }));
    expect(fns(w.rpc).filter((f) => f.startsWith("agent_llm"))).toEqual([]);
  });

  it("agent.ask: teto estourado → resposta determinística, sem chamar o modelo e sem gravar uso", async () => {
    const over = world(() => READING, "owner", { allowance: { data: { allowed: false, used_tokens: 400100, limit_tokens: 400000 }, error: null } });
    const res = await over.handler(post("agent.ask", PEDIDO));
    expect(res.status).toBe(200);
    const body = AgentAnswer.parse((await res.json()).data);
    expect(over.sent).toHaveLength(0);
    expect(records(over.rpc)).toEqual([]);
    expect(fns(over.rpc)).not.toContain("agent_directory");
    // Igual ao assistente sem provedor.
    const none = createAgentHandler({ rpc: world(() => READING).rpc, allowedOrigins: [], clock: { now: () => NOW } });
    const det = AgentAnswer.parse((await (await none(post("agent.ask", PEDIDO))).json()).data);
    expect(body).toEqual(det);
    expect(body.text).toMatch(/Não entendi/);
    expect(agentLog(over.log)).toMatchObject({ llm: "over_limit", llm_budget: "exceeded" });
  });

  it("agent.ask: teto que não dá para consultar → sem modelo (erra para o lado do determinístico)", async () => {
    const w = world(() => READING, "owner", { allowance: { data: null, error: { code: "08006", message: "connection failure" } } });
    const res = await w.handler(post("agent.ask", PEDIDO));
    expect(res.status).toBe(200);
    expect(w.sent).toHaveLength(0);
    expect(agentLog(w.log)).toMatchObject({ llm: "over_limit", llm_budget: "error" });
  });

  it("agent.ask: falha ao gravar o uso não derruba a resposta; vai para o log só como contagem", async () => {
    const w = world(() => READING, "owner", { record: { data: null, error: { code: "08006", message: "connection failure" } } });
    const res = await w.handler(post("agent.ask", PEDIDO));
    expect(res.status).toBe(200);
    expect(AgentAnswer.parse((await res.json()).data).proposal?.tool).toBe("booking.create");
    expect(agentLog(w.log)).toMatchObject({ llm_usage_unrecorded: 1 });
  });

  it("agent.ask: principal fora do ar e reserva responde → as duas tentativas gravadas (erro conta com tokens zero)", async () => {
    let n = 0;
    const w = world(() => (n++ === 0 ? new Error("caiu") : READING), "owner", { fallback: true });
    const res = await w.handler(post("agent.ask", PEDIDO));
    expect(AgentAnswer.parse((await res.json()).data).proposal?.tool).toBe("booking.create");
    expect(w.sent).toHaveLength(2);
    expect(records(w.rpc)).toEqual([
      { p_tenant_id: TENANT, p_task: "intent", p_input_tokens: 0, p_output_tokens: 0, p_cost_usd: 0 },
      { p_tenant_id: TENANT, p_task: "intent", p_input_tokens: 10, p_output_tokens: 5, p_cost_usd: 0.000004 },
    ]);
  });

  it("LLM_PROVIDER=none: nenhuma RPC de uso, nem com pedido que o motor não entende, nem na redação", async () => {
    const rpc = world(() => READING).rpc;
    const handler = createAgentHandler({ rpc, allowedOrigins: [], clock: { now: () => NOW } });
    await handler(post("agent.ask", PEDIDO));
    await handler(post("agent.draft", { kind: "message", text: "Oi, tudo bem?" }));
    expect(fns(rpc)).toEqual(["agent_run_start"]);
  });

  it("agent.draft: teto antes do débito; uso gravado com a tarefa draft", async () => {
    const w = world((req) => ({ text: req.input.replace("Oi", "Olá") }));
    const res = await w.handler(post("agent.draft", { kind: "message", text: "Oi, tudo bem?" }));
    expect(AgentDraftOutput.parse((await res.json()).data)).toEqual({ available: true, suggestion: "Olá, tudo bem?" });
    expect(fns(w.rpc)).toEqual(["agent_llm_allowance", "agent_run_start", "agent_directory", "agent_llm_record"]);
    expect(records(w.rpc)[0]).toMatchObject({ p_task: "draft", p_input_tokens: 10, p_output_tokens: 5 });
  });

  it("agent.draft: teto estourado → igual a sem provedor (available false), sem débito nem modelo", async () => {
    const w = world(() => ({ text: "x" }), "owner", { allowance: { data: { allowed: false, used_tokens: 5, limit_tokens: 0 }, error: null } });
    const res = await w.handler(post("agent.draft", { kind: "message", text: "Oi, tudo bem?" }));
    expect(AgentDraftOutput.parse((await res.json()).data)).toEqual({ available: false, suggestion: null });
    expect(fns(w.rpc)).toEqual(["agent_llm_allowance"]);
    expect(w.sent).toHaveLength(0);
  });

  it("agent.draft: sem vínculo continua 403 (o teto não vira outra porta)", async () => {
    const w = world(() => ({ text: "x" }), "owner", { allowance: { data: null, error: { code: "PT403", message: "FORBIDDEN" } } });
    const res = await w.handler(post("agent.draft", { kind: "message", text: "Oi, tudo bem?" }));
    expect(res.status).toBe(403);
    expect(w.sent).toHaveLength(0);
  });
});
