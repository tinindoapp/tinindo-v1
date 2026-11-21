// @vitest-environment node
// Assistente, parte 2 (revisão 06/11, T16): roda tests/agent-evals/assist-cases.json (SETUP-*, EXPLAIN-* e INJ-*).
// Cada caso roda cinco vezes:
//   none      → LLM_PROVIDER=none: o resultado do motor, sem modelo, sem portão e sem débito;
//   scripted  → a leitura do modelo roteirizada, pelo cliente real da camada de linguagem (redação, zod, registro);
//   anthropic, openai, gemini → os adaptadores reais contra o servidor falso local (tests/contracts/llm/fake-provider.ts).
// Sem rede. O que sai para o modelo é conferido no corpo do pedido (telefone, e-mail, CEP e endereço nunca saem).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { type FakeProvider, type Provider, startFakeProvider } from "../../../tests/contracts/llm/fake-provider.ts";
import { FX } from "../_shared/contracts/fixtures.ts";
import type { AgentContext, AgentData, InsightsRead } from "../_shared/domain/agent/types.ts";
import { FormDraftOutput, type FormId, LLM_FORM_SCHEMAS } from "../_shared/domain/agent/forms.ts";
import { InsightExplainOutput } from "../_shared/domain/agent/insight-explain.ts";
import type { RpcResult } from "../_shared/http/rpc-handler.ts";
import { createAnthropicAdapter } from "../_shared/llm/adapters/anthropic.ts";
import { createGeminiAdapter } from "../_shared/llm/adapters/gemini.ts";
import { createOpenAIAdapter } from "../_shared/llm/adapters/openai.ts";
import { createLlm } from "../_shared/llm/client.ts";
import { type Llm, noneLlm } from "../_shared/llm/index.ts";
import { LlmIntent } from "../_shared/llm/tasks/intent.ts";
import type { Adapter, LlmTask } from "../_shared/llm/types.ts";
import { createGrowthAdviceHandler } from "../growth-advice/handler.ts";
import { createAgentHandler } from "./handler.ts";
import { understand } from "./understand.ts";

// ------------------------------------------------------------------------------------------------ suíte

interface Expect {
  intent?: string;
  intent_prefix?: string;
  llm?: "none" | "used" | "discarded";
  text_must_match?: string[];
  text_must_not_match?: string[];
  tools_allowed?: string[];
  no_proposal?: boolean;
  draft?: Record<string, unknown> | null;
  draft_has?: string[];
  draft_lacks?: string[];
  draft_must_not_match?: string[];
  filled?: string[];
  filled_has?: string[];
  notes_fields?: string[];
  sent_must_not_match?: string[];
  source?: "assistant" | "fixed";
  model_calls?: number;
  gate_calls?: number;
}
interface Case {
  id: string;
  category: "setup" | "explain" | "injection";
  severity: "blocker" | "major";
  op: "chat" | "form_draft" | "explain";
  about?: string;
  input?: { text?: string; form?: FormId; ui?: { insight_id?: string } };
  cached?: string;
  model_reply: Record<string, unknown> | null;
  expect?: Expect;
  expect_none?: Expect;
  expect_model?: Expect;
}
interface Suite {
  world: {
    now: string;
    tenant: AgentContext["tenant"];
    services: unknown[];
    insights: InsightsRead["insights"];
    rules: InsightsRead["rules"];
    setup_steps: unknown[];
    lifecycle: Record<string, unknown>;
    explain: { insight_id: string; rule_code: string; rule_title: string; version: number; evidence: Record<string, unknown> };
  };
  cases: Case[];
}

const suite = JSON.parse(readFileSync(resolve(process.cwd(), "tests/agent-evals/assist-cases.json"), "utf8")) as Suite;
const W = suite.world;
const NOW = new Date(W.now);
const AS_OF = W.now.replace(".000Z", "Z");

type Mode = "none" | "scripted" | Provider;
const MODES: Mode[] = ["none", "scripted", "anthropic", "openai", "gemini"];
const PROVIDERS: Provider[] = ["anthropic", "openai", "gemini"];

// ------------------------------------------------------------------------------------------------ modelo

/** A resposta do modelo é sempre a forma fechada inteira: o que o caso não diz vai null; chaves a mais ficam (é o teste). */
function fullReply(c: Case): unknown {
  const r = c.model_reply ?? {};
  if (c.op === "form_draft") {
    const keys = Object.keys(LLM_FORM_SCHEMAS[c.input!.form!].shape);
    return { ...Object.fromEntries(keys.map((k) => [k, null])), ...r };
  }
  if (c.op === "chat") {
    const keys = Object.keys(LlmIntent.shape).filter((k) => k !== "intent");
    return { intent: "other", ...Object.fromEntries(keys.map((k) => [k, null])), ...r };
  }
  return r;
}

const MODELS: Record<Provider, string> = { anthropic: "claude-haiku-5-5", openai: "modelo-openai-teste", gemini: "modelo-gemini-teste" };
const models = (m: string) => Object.fromEntries((["intent", "setup", "draft", "explain"] as LlmTask[]).map((t) => [t, m])) as Record<LlmTask, string>;

const fakes = new Map<Provider, FakeProvider>();
beforeAll(async () => {
  for (const p of PROVIDERS) fakes.set(p, await startFakeProvider(p));
});
afterAll(async () => {
  for (const f of fakes.values()) await f.close();
});

/** O cliente de linguagem de cada modo, e o que saiu para o "modelo" (texto do pedido) e quantas chamadas houve. */
function llmFor(mode: Mode, c: Case): { llm: Llm; sent: () => string[] } {
  if (mode === "none") return { llm: noneLlm, sent: () => [] };
  const reply = fullReply(c);
  if (mode === "scripted") {
    const sent: string[] = [];
    const adapter: Adapter = {
      provider: "anthropic",
      call: async (req) => {
        sent.push(`${req.system}\n${req.input}`);
        return { text: JSON.stringify(reply), refusal: false, truncated: false, usage: { input_tokens: 10, output_tokens: 5 } };
      },
    };
    return { llm: createLlm({ adapter, models: models(MODELS.anthropic) }, null, { log: vi.fn() }), sent: () => sent };
  }
  const fake = fakes.get(mode)!;
  fake.scenario = "success";
  fake.payload = reply;
  const start = fake.requests.length;
  const opts = { apiKey: "chave-falsa-de-teste", timeoutMs: 2000, baseURL: fake.baseURL };
  const adapter = mode === "anthropic" ? createAnthropicAdapter(opts) : mode === "openai" ? createOpenAIAdapter(opts) : createGeminiAdapter(opts);
  return { llm: createLlm({ adapter, models: models(MODELS[mode]) }, null, { log: vi.fn() }), sent: () => fake.requests.slice(start).map((r) => r.raw) };
}

// ------------------------------------------------------------------------------------------------ mundo

function agentData(): AgentData {
  return {
    directory: async () => ({ services: W.services, customers: [], customers_total: 0, pricing_rules: [], cancellation: null, waitlist: { active: 3, offered: 1 }, as_of: AS_OF }) as never,
    agenda: async (w) => ({ resource_id: null, timezone: W.tenant.timezone, as_of: AS_OF, bookings: [], days: [{ date: w.starts_at.slice(0, 10), open: [], blocks: [] }] }) as never,
    finance: async () => { throw new Error("o caixa não entra nestes casos"); },
    insights: async () => ({ insights: W.insights, rules: W.rules, as_of: AS_OF }),
    setup: async () => ({ progress: { done_count: W.setup_steps.filter((s) => (s as { done: boolean }).done).length, steps: W.setup_steps }, as_of: AS_OF }) as never,
    lifecycle: async () => ({ settings: W.lifecycle, as_of: AS_OF }) as never,
    waitlist: async () => ({ by_service: [], open_offers: [], as_of: AS_OF }),
  };
}

type Rpc = (token: string, fn: string, args: Record<string, unknown>) => Promise<RpcResult>;
function rpcWorld(c: Case) {
  const stored = new Map<number, string>();
  if (c.cached) stored.set(W.explain.version, c.cached);
  return vi.fn<Rpc>(async (_t, fn, a) => {
    switch (fn) {
      case "agent_llm_allowance": return { data: { allowed: true, used_tokens: 0, limit_tokens: 400000 }, error: null };
      case "agent_llm_record": return { data: null, error: null };
      case "agent_run_start": return { data: { run_id: "e0000000-0000-4000-8000-000000000001", role: "owner", tenant_name: W.tenant.name, timezone: W.tenant.timezone }, error: null };
      case "insight_explanation_get":
        return { data: { ...W.explain, state: "open", text: stored.get(W.explain.version) ?? null }, error: null };
      case "insight_explanation_save":
        if (!stored.has(W.explain.version)) stored.set(W.explain.version, String(a.p_text));
        return { data: { insight_id: W.explain.insight_id, version: W.explain.version, saved: true, text: stored.get(W.explain.version) }, error: null };
      default: return { data: null, error: { code: "PT403", message: "FORBIDDEN" } };
    }
  });
}
const headers = { Authorization: "Bearer jwt-do-dono", "X-Tinindo-Tenant": FX.tenants.A };

// ------------------------------------------------------------------------------------------------ execução

interface Outcome {
  text: string;
  intent?: string;
  llm?: string;
  tools?: string[];
  proposal?: boolean;
  draft?: Record<string, unknown> | null;
  filled?: string[];
  notes?: (string | null)[];
  available?: boolean;
  source?: string;
  sent: string[];
  modelCalls: number;
  gateCalls: number;
}

async function run(c: Case, mode: Mode): Promise<Outcome> {
  const { llm, sent } = llmFor(mode, c);
  if (c.op === "chat") {
    const ctx: AgentContext = { tenant: W.tenant, role: "owner", now: NOW, ui: c.input?.ui };
    const u = await understand(c.input!.text!, ctx, agentData(), llm, async () => true);
    return {
      text: u.result.text, intent: u.result.intent, llm: u.llm, tools: u.result.tool_calls.map((t) => t.tool), proposal: u.result.draft !== null,
      sent: sent(), modelCalls: sent().length, gateCalls: 0,
    };
  }
  const rpc = rpcWorld(c);
  const gateCalls = () => rpc.mock.calls.filter((x) => x[1] === "agent_run_start").length;
  if (c.op === "form_draft") {
    const handler = createAgentHandler({ rpc, allowedOrigins: [], log: vi.fn(), llm, clock: { now: () => NOW } });
    const res = await handler(new Request("http://edge/functions/v1/agent/assist.form_draft", { method: "POST", headers, body: JSON.stringify({ form: c.input!.form, text: c.input!.text }) }));
    expect(res.status).toBe(200);
    const out = FormDraftOutput.parse(((await res.json()) as { data: unknown }).data);
    return {
      text: JSON.stringify(out), draft: out.draft as Record<string, unknown> | null, filled: out.filled, notes: out.notes.map((n) => n.field), available: out.available,
      sent: sent(), modelCalls: sent().length, gateCalls: gateCalls(),
    };
  }
  const handler = createGrowthAdviceHandler({ rpc, allowedOrigins: [], log: vi.fn(), llm });
  const res = await handler(new Request("http://edge/functions/v1/growth-advice/insight.explain", { method: "POST", headers, body: JSON.stringify({ insight_id: W.explain.insight_id }) }));
  expect(res.status).toBe(200);
  const out = InsightExplainOutput.parse(((await res.json()) as { data: unknown }).data);
  return { text: out.text, source: out.source, sent: sent(), modelCalls: sent().length, gateCalls: gateCalls() };
}

const re = (s: string) => new RegExp(s, "iu");

function check(c: Case, mode: Mode, o: Outcome) {
  const e: Expect = (mode === "none" ? c.expect_none : c.expect_model) ?? c.expect ?? {};
  // Regras de todos os casos: o que sai para o modelo nunca leva contato nem endereço; sem provedor, nada sai.
  for (const body of o.sent) expect(body, "dado pessoal saiu para o modelo").not.toMatch(/\d{4,5}-?\d{4}\b(?!\d)|@[a-z0-9-]+\.[a-z]{2,}|\b\d{5}-\d{3}\b/iu);
  for (const p of e.sent_must_not_match ?? []) for (const body of o.sent) expect(body).not.toMatch(re(p));
  if (mode === "none") expect(o.modelCalls).toBe(0);

  if (c.op === "form_draft" && mode === "none") {
    // Sem provedor o "Faz comigo" só diz que está desligado: sem portão, sem débito, sem rascunho.
    expect(o).toMatchObject({ available: false, draft: null, filled: [], gateCalls: 0 });
    return;
  }
  if (e.intent) expect(o.intent).toBe(e.intent);
  if (e.intent_prefix) expect(o.intent).toMatch(new RegExp(`^${e.intent_prefix}`));
  if (e.llm) expect(o.llm).toBe(mode === "none" ? "none" : e.llm);
  for (const p of e.text_must_match ?? []) expect(o.text).toMatch(re(p));
  for (const p of e.text_must_not_match ?? []) expect(o.text).not.toMatch(re(p));
  if (e.tools_allowed) for (const t of o.tools ?? []) expect(e.tools_allowed).toContain(t);
  if (e.no_proposal) expect(o.proposal).toBe(false);
  if (c.op === "chat") expect(o.proposal, "SETUP/EXPLAIN nunca propõem ação").toBe(false);

  if (c.op === "form_draft") {
    expect(o.available).toBe(true);
    // Nenhum rascunho traz id, versão ou campo de outro negócio, nem com o texto mandando.
    if (o.draft) expect(Object.keys(o.draft).filter((k) => /(^id$|_id$|^version$|tenant)/.test(k))).toEqual([]);
    if (e.draft !== undefined) expect(o.draft).toEqual(e.draft);
    for (const k of e.draft_has ?? []) expect(o.draft).toHaveProperty(k);
    for (const k of e.draft_lacks ?? []) expect(o.draft ?? {}).not.toHaveProperty(k);
    for (const p of e.draft_must_not_match ?? []) expect(JSON.stringify(o.draft)).not.toMatch(re(p));
    if (e.filled) expect([...(o.filled ?? [])].sort()).toEqual(e.filled);
    for (const f of e.filled_has ?? []) expect(o.filled).toContain(f);
    for (const f of e.notes_fields ?? []) expect(o.notes).toContain(f);
    expect(o.gateCalls).toBe(1);
  }
  if (c.op === "explain") {
    if (e.source) expect(o.source).toBe(e.source);
    if (e.model_calls !== undefined) expect(o.modelCalls).toBe(e.model_calls);
    if (e.gate_calls !== undefined) expect(o.gateCalls).toBe(e.gate_calls);
  }
}

describe("avaliação do assistente, parte 2 (SETUP, EXPLAIN e injeção nos rascunhos)", () => {
  it("a suíte é coerente: ids únicos, prefixo bate com a categoria, cada caso tem expectativa", () => {
    const ids = suite.cases.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    const prefix = { setup: "SETUP-", explain: "EXPLAIN-", injection: "INJ-" } as const;
    for (const c of suite.cases) {
      expect(c.id.startsWith(prefix[c.category]), c.id).toBe(true);
      expect(c.expect ?? (c.expect_none && c.expect_model), c.id).toBeTruthy();
      if (c.op !== "explain") expect(c.input?.text, c.id).toBeTruthy();
    }
    for (const cat of ["setup", "explain", "injection"]) expect(suite.cases.filter((c) => c.category === cat).length).toBeGreaterThanOrEqual(7);
  });

  describe.each(MODES)("%s", (mode) => {
    it.each(suite.cases.map((c) => [`${c.id} (${c.severity})`, c] as const))("%s", async (_name, c) => {
      check(c, mode, await run(c, mode));
    });
  });
});
