// P46 · cada adaptador (SDK oficial do provedor) contra um servidor falso local, sem rede: sucesso, JSON inválido,
// recusa, limite (429) e tempo esgotado. Toda falha vira null + registro sem conteúdo; nada de temperature/top_p/top_k;
// telefone, e-mail e documento nunca saem no corpo do pedido.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { createAnthropicAdapter } from "../../../supabase/functions/_shared/llm/adapters/anthropic.ts";
import { createGeminiAdapter } from "../../../supabase/functions/_shared/llm/adapters/gemini.ts";
import { createOpenAIAdapter } from "../../../supabase/functions/_shared/llm/adapters/openai.ts";
import { createLlm } from "../../../supabase/functions/_shared/llm/client.ts";
import { PRICE_TABLE_VERSION } from "../../../supabase/functions/_shared/llm/prices.ts";
import type { Adapter, LlmLogEntry, LlmTask } from "../../../supabase/functions/_shared/llm/types.ts";
import { type FakeProvider, type Provider, type Scenario, startFakeProvider } from "./fake-provider.ts";

const Schema = z.object({ intent: z.enum(["agenda", "other"]), day: z.string().nullable() });
const GOOD = { intent: "agenda", day: "2026-11-05" };
const PII_INPUT = "Minha agenda de quinta. Cliente: maria@example.com, (11) 98765-4321, CPF 123.456.789-09.";
const TIMEOUT_MS = 300;

const MODELS: Record<Provider, string> = { anthropic: "claude-haiku-5-5", openai: "modelo-openai-teste", gemini: "modelo-gemini-teste" };
const models = (m: string) => Object.fromEntries((["intent", "setup", "draft", "explain"] as LlmTask[]).map((t) => [t, m])) as Record<LlmTask, string>;

function adapter(p: Provider, baseURL: string): Adapter {
  const opts = { apiKey: "chave-falsa-de-teste", timeoutMs: TIMEOUT_MS, baseURL };
  return p === "anthropic" ? createAnthropicAdapter(opts) : p === "openai" ? createOpenAIAdapter(opts) : createGeminiAdapter(opts);
}

describe.each<Provider>(["anthropic", "openai", "gemini"])("adaptador %s", (provider) => {
  let fake: FakeProvider;
  const logs: LlmLogEntry[] = [];
  let llm: ReturnType<typeof createLlm>;

  beforeAll(async () => {
    fake = await startFakeProvider(provider);
    llm = createLlm({ adapter: adapter(provider, fake.baseURL), models: models(MODELS[provider]) }, null, { log: (e) => logs.push(e) });
  });
  afterAll(async () => {
    await fake.close();
  });

  async function run(scenario: Scenario, payload: unknown = GOOD) {
    fake.scenario = scenario;
    fake.payload = payload;
    const before = fake.requests.length;
    const value = await llm.extract({ task: "intent", system: "Classifique.", input: PII_INPUT, schema: Schema });
    return { value, log: logs.at(-1)!, request: fake.requests[before] };
  }

  it("sucesso: objeto validado pelo zod, registro ok com tokens e custo", async () => {
    const { value, log, request } = await run("success");
    expect(value).toEqual(GOOD);
    expect(log).toMatchObject({ fn: "llm", task: "intent", provider, model: MODELS[provider], input_tokens: 120, output_tokens: 30, result: "ok", fallback: false, price_table: PRICE_TABLE_VERSION });
    expect(log.ms).toBeGreaterThanOrEqual(0);
    if (provider === "anthropic") expect(log.cost_usd).toBeCloseTo((120 * 0.10 + 30 * 0.50) / 1e6, 9);
    else expect(log.cost_usd).toBeNull(); // modelo sem preço na tabela: null, nunca zero
    expect(request).toBeDefined();
  });

  it("o pedido usa a saída estruturada do provedor, o modelo do segredo e nada de temperature/top_p/top_k", async () => {
    const { request } = await run("success");
    const raw = request!.raw;
    for (const k of ["temperature", "top_p", "top_k", "topP", "topK"]) expect(raw).not.toContain(`"${k}"`);
    const b = request!.body as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    if (provider === "anthropic") {
      expect(request!.path).toBe("/v1/messages");
      expect(b.model).toBe("claude-haiku-5-5");
      expect(b.output_config).toMatchObject({ effort: "low", format: { type: "json_schema" } });
      expect(b.output_config.format.schema).toMatchObject({ type: "object", additionalProperties: false, required: ["intent", "day"] });
    } else if (provider === "openai") {
      expect(request!.path).toBe("/v1/responses");
      expect(b.model).toBe(MODELS.openai);
      expect(b.store).toBe(false);
      expect(b.text.format).toMatchObject({ type: "json_schema", strict: true, name: "tinindo_intent" });
    } else {
      expect(request!.path).toContain(`/models/${MODELS.gemini}:generateContent`);
      expect(b.generationConfig).toMatchObject({ responseMimeType: "application/json" });
      expect(b.generationConfig.responseJsonSchema).toMatchObject({ type: "object" });
    }
  });

  it("telefone, e-mail e documento não saem para o provedor", async () => {
    const { request } = await run("success");
    const raw = request!.raw;
    for (const leak of ["maria@example.com", "98765-4321", "98765", "123.456.789-09", "789"]) expect(raw).not.toContain(leak);
    expect(raw).toContain("[e-mail]");
    expect(raw).toContain("[telefone]");
    expect(raw).toContain("[documento]");
  });

  it("JSON inválido → null, registro invalid", async () => {
    const { value, log } = await run("invalid_json");
    expect(value).toBeNull();
    expect(log.result).toBe("invalid");
  });

  it("JSON válido fora do schema → null, registro invalid", async () => {
    const { value, log } = await run("success", { intent: "mandar_pix", day: 5 });
    expect(value).toBeNull();
    expect(log.result).toBe("invalid");
  });

  it("recusa do provedor → null, registro refusal", async () => {
    const { value, log } = await run("refusal");
    expect(value).toBeNull();
    expect(log.result).toBe("refusal");
  });

  it("limite (429) → null sem nova tentativa, registro rate_limited", async () => {
    const before = fake.requests.length;
    const { value, log } = await run("rate_limited");
    expect(value).toBeNull();
    expect(log.result).toBe("rate_limited");
    expect(fake.requests.length - before).toBe(1);
  });

  it("tempo esgotado → null dentro do teto, registro timeout", async () => {
    const t0 = Date.now();
    const { value, log } = await run("timeout");
    expect(value).toBeNull();
    expect(log.result).toBe("timeout");
    expect(Date.now() - t0).toBeLessThan(2500);
  });

  it("o registro nunca tem conteúdo (pedido, resposta ou sistema)", () => {
    const all = JSON.stringify(logs);
    for (const s of ["quinta", "Classifique", "agenda\"", "2026-11-05", "maria", "chave-falsa"]) expect(all).not.toContain(s);
    const keys = new Set(logs.flatMap((l) => Object.keys(l)));
    expect([...keys].sort()).toEqual(["cost_usd", "fallback", "fn", "input_tokens", "model", "ms", "output_tokens", "price_table", "provider", "result", "task"]);
  });
});

describe("reserva (LLM_FALLBACK_PROVIDER)", () => {
  it("principal falha (429) → tenta a reserva uma vez; os dois registros saem marcados", async () => {
    const a = await startFakeProvider("anthropic");
    const o = await startFakeProvider("openai");
    try {
      a.scenario = "rate_limited";
      o.scenario = "success";
      o.payload = GOOD;
      const logs: LlmLogEntry[] = [];
      const llm = createLlm(
        { adapter: adapter("anthropic", a.baseURL), models: models("claude-haiku-5-5") },
        { adapter: adapter("openai", o.baseURL), models: models("modelo-openai-teste") },
        { log: (e) => logs.push(e) },
      );
      expect(await llm.extract({ task: "intent", system: "x", input: "agenda", schema: Schema })).toEqual(GOOD);
      expect(logs.map((l) => [l.provider, l.result, l.fallback])).toEqual([["anthropic", "rate_limited", false], ["openai", "ok", true]]);
    } finally {
      await a.close();
      await o.close();
    }
  });
});
