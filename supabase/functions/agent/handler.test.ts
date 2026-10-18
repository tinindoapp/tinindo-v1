import { describe, expect, it, vi } from "vitest";
import { AgentAnswer, ErrorEnvelope } from "../_shared/contracts/index.ts";
import { FX } from "../_shared/contracts/fixtures.ts";
import type { RpcResult } from "../_shared/http/rpc-handler.ts";
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

type Rpc = (token: string, fn: string, args: Record<string, unknown>) => Promise<RpcResult>;
function world(over: Partial<Record<string, RpcResult | ((args: Record<string, unknown>) => RpcResult)>> = {}) {
  const base: Record<string, (args: Record<string, unknown>) => RpcResult> = {
    agent_run_start: () => ({ data: { run_id: RUN, role: "owner", tenant_name: "Barbearia Exemplo A", timezone: "America/Sao_Paulo" }, error: null }),
    agent_directory: () => ({ data: directory, error: null }),
    agent_agenda_read: (a) => ({ data: agenda(String(a.p_from)), error: null }),
    agent_finance_read: () => ({ data: null, error: { code: "PT403", message: "FORBIDDEN" } }),
    agent_proposal_create: (a) => ({
      data: { status_code: 201, body: {
        proposal_id: PROPOSAL, tenant_id: TENANT, tool: a.p_tool, payload: a.p_payload, payload_hash: "f".repeat(64), policy_version: 1,
        version: 1, expires_at: "2026-10-20T12:30:00Z", approval_state: "pending", summary: a.p_summary,
      } }, error: null,
    }),
  };
  const rpc = vi.fn<Rpc>(async (_t, fn, args) => {
    const o = over[fn];
    if (o) return typeof o === "function" ? o(args) : o;
    return base[fn]!(args);
  });
  const log = vi.fn();
  return { rpc, log, handler: createAgentHandler({ rpc, allowedOrigins: [], log, clock: { now: () => NOW } }) };
}
const post = (op: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://edge/functions/v1/agent/${op}`, {
    method: "POST", body: JSON.stringify(body),
    headers: { Authorization: "Bearer jwt-do-dono", "X-Tinindo-Tenant": TENANT, ...headers },
  });

describe("Edge Function agent · agent.ask", () => {
  it("sem vínculo: 403 antes de qualquer ferramenta (AE-29/30)", async () => {
    const w = world({ agent_run_start: { data: null, error: { code: "PT403", message: "FORBIDDEN" } } });
    const res = await w.handler(post("agent.ask", { text: "quanto recebi essa semana?" }));
    expect(res.status).toBe(403);
    expect(ErrorEnvelope.parse(await res.json()).error.code).toBe("FORBIDDEN");
    expect(w.rpc).toHaveBeenCalledTimes(1);
  });

  it("franquia esgotada: 429 com mensagem honesta e nenhuma leitura (AE-33)", async () => {
    const w = world({ agent_run_start: { data: null, error: { code: "PT429", message: "QUOTA_EXCEEDED" } } });
    const res = await w.handler(post("agent.ask", { text: "me ajuda a pensar uma promoção pra quinta" }));
    expect(res.status).toBe(429);
    const body = ErrorEnvelope.parse(await res.json());
    expect(body.error.code).toBe("QUOTA_EXCEEDED");
    expect(body.error.message).toMatch(/limite/);
    expect(w.rpc).toHaveBeenCalledTimes(1);
  });

  it("a mesma Idempotency-Key chega ao débito (retry não debita duas vezes)", async () => {
    const w = world();
    await w.handler(post("agent.ask", { text: "o que tenho amanhã?" }, { "Idempotency-Key": "pergunta-0000000001" }));
    expect(w.rpc).toHaveBeenCalledWith("jwt-do-dono", "agent_run_start", { p_tenant_id: TENANT, p_idem_key: "pergunta-0000000001" });
  });

  it("consulta responde pelas ferramentas, com fontes e sem proposta; o log não leva o texto", async () => {
    const w = world();
    const res = await w.handler(post("agent.ask", { text: "o que tenho amanhã?" }));
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: unknown };
    const answer = AgentAnswer.parse(data);
    expect(answer.state).toBe("consulted");
    expect(answer.proposal).toBeNull();
    expect(answer.text).toMatch(/nenhum atendimento/);
    expect(answer.sources.some((s) => s.kind === "agenda")).toBe(true);
    expect(w.rpc).toHaveBeenCalledWith("jwt-do-dono", "agent_agenda_read", expect.objectContaining({ p_tenant_id: TENANT }));
    expect(JSON.stringify(w.log.mock.calls)).not.toContain("amanhã");
    expect(w.log.mock.calls[0]?.[0]).toMatchObject({ intent: "agenda", status: 200 });
  });

  it("pedido inequívoco vira proposta pendente gravada pelo banco, vinculada à execução", async () => {
    const w = world();
    const res = await w.handler(post("agent.ask", { text: "marca um corte pra Maria Exemplo Silva quinta às 10h" }));
    const answer = AgentAnswer.parse(((await res.json()) as { data: unknown }).data);
    expect(answer.state).toBe("pending_approval");
    expect(answer.proposal).toMatchObject({ proposal_id: PROPOSAL, tool: "booking.create", approval_state: "pending" });
    const create = w.rpc.mock.calls.find((c) => c[1] === "agent_proposal_create")?.[2];
    expect(create).toMatchObject({ p_run_id: RUN, p_tool: "booking.create" });
    expect(create?.p_payload).toMatchObject({ customer_id: maria.id, service_id: corte.id, starts_at: "2026-10-22T13:00:00Z", expected_price_cents: 6000 });
    expect(String(create?.p_idem_key)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("sem permissão numa ferramenta (equipe no financeiro): resposta honesta, não erro", async () => {
    const w = world({ agent_run_start: { data: { run_id: RUN, role: "staff", tenant_name: "Barbearia Exemplo A", timezone: "America/Sao_Paulo" }, error: null } });
    const res = await w.handler(post("agent.ask", { text: "quanto recebi semana passada?" }));
    expect(res.status).toBe(200);
    expect(AgentAnswer.parse(((await res.json()) as { data: unknown }).data).text).toMatch(/Só o dono/);
  });

  it("banco fora do ar: 503 explícito, nunca resposta inventada (AE-20)", async () => {
    const w = world();
    w.rpc.mockImplementationOnce(async () => {
      throw new Error("rede");
    });
    const res = await w.handler(post("agent.ask", { text: "o que tenho hoje?" }));
    expect(res.status).toBe(503);
    expect(ErrorEnvelope.parse(await res.json()).error.code).toBe("PROVIDER_UNAVAILABLE");
  });

  it("valida entrada, autenticação e seleção de negócio", async () => {
    const w = world();
    expect((await w.handler(post("agent.ask", { text: "" }))).status).toBe(400);
    expect((await w.handler(new Request("http://edge/functions/v1/agent/agent.ask", { method: "POST", body: "{}" }))).status).toBe(401);
    expect((await w.handler(post("agent.ask", { text: "oi" }, { "X-Tinindo-Tenant": "B" }))).status).toBe(400);
    expect(w.rpc).not.toHaveBeenCalled();
  });
});

describe("Edge Function agent · aprovar e executar", () => {
  it("action.approve exige chave e repassa hash e versão vistos", async () => {
    const approval = { approval_id: "e0000000-0000-4000-8000-000000000003", proposal_id: PROPOSAL, approver_user_id: FX.users.ownerA,
      approved_at: "2026-10-20T12:01:00Z", expires_at: "2026-10-20T12:16:00Z" };
    const w = world({ action_approve: { data: { status_code: 200, body: approval }, error: null } });
    const input = { proposal_id: PROPOSAL, payload_hash: "f".repeat(64), expected_version: 1 };
    expect((await w.handler(post("action.approve", input))).status).toBe(400);
    const res = await w.handler(post("action.approve", input, { "Idempotency-Key": "aprovacao-000000001" }));
    expect(res.status).toBe(200);
    expect(w.rpc).toHaveBeenCalledWith("jwt-do-dono", "action_approve", expect.objectContaining({
      p_proposal_id: PROPOSAL, p_payload_hash: "f".repeat(64), p_expected_version: 1, p_idem_key: "aprovacao-000000001",
    }));
  });

  it("aprovação velha: 409 STALE_VERSION do banco chega ao cliente", async () => {
    const w = world({ action_approve: { data: null, error: { code: "PT409", message: "STALE_VERSION" } } });
    const res = await w.handler(post("action.approve", { proposal_id: PROPOSAL, payload_hash: "f".repeat(64), expected_version: 1 },
      { "Idempotency-Key": "aprovacao-000000002" }));
    expect(res.status).toBe(409);
  });

  it("action.execute devolve o recibo do banco (executado ou recusado pela política)", async () => {
    const receipt = { approval_id: "e0000000-0000-4000-8000-000000000003", status: "rejected_by_policy", result_ref: null, executed_at: "2026-10-20T12:02:00Z" };
    const w = world({ action_execute: { data: { status_code: 200, body: receipt }, error: null } });
    const res = await w.handler(post("action.execute", { approval_id: receipt.approval_id }, { "Idempotency-Key": "execucao-0000000001" }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { data: unknown }).data).toEqual(receipt);
  });
});
