// T11 · medidor de uso: cada tentativa ao modelo (inclusive a reserva) chega ao sink com tarefa, tokens e custo; sem
// texto. `none` não tem nada a medir. Sink com erro não muda o resultado.
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { noneLlm } from "./adapters/none.ts";
import { createLlm } from "./client.ts";
import type { Adapter, LlmTask, LlmUsage } from "./types.ts";
import { withUsage } from "./usage.ts";

const Out = z.object({ ok: z.boolean() });
const modelsOf = (m: string) => Object.fromEntries((["intent", "setup", "draft", "explain"] as LlmTask[]).map((t) => [t, m])) as Record<LlmTask, string>;
const adapter = (provider: Adapter["provider"], reply: () => Promise<string>, usage = { input_tokens: 700, output_tokens: 100 }): Adapter => ({
  provider,
  call: async () => ({ text: await reply(), refusal: false, truncated: false, usage }),
});
const REQ = { task: "intent" as const, system: "s", input: "marca a cliente 1 na Rua Augusta, 123, CEP 01310-100", schema: Out };

describe("withUsage", () => {
  it("none: devolve o próprio llm e o sink nunca é chamado", async () => {
    const sink = vi.fn();
    const llm = withUsage(noneLlm, sink);
    expect(llm).toBe(noneLlm);
    expect(await llm.extract(REQ)).toBeNull();
    expect(sink).not.toHaveBeenCalled();
  });

  it("uma tentativa: tarefa, tokens e custo pela tabela; só números", async () => {
    const events: LlmUsage[] = [];
    const base = createLlm({ adapter: adapter("anthropic", async () => '{"ok":true}'), models: modelsOf("claude-haiku-5-5") }, null);
    const out = await withUsage(base, (u) => events.push(u)).extract(REQ);
    expect(out).toEqual({ ok: true });
    expect(events).toEqual([{ task: "intent", input_tokens: 700, output_tokens: 100, cost_usd: 0.00012 }]);
    expect(Object.keys(events[0]!).sort()).toEqual(["cost_usd", "input_tokens", "output_tokens", "task"]);
  });

  it("principal falha e reserva sem preço responde: duas entradas, a da reserva com custo null (nunca zero)", async () => {
    const events: LlmUsage[] = [];
    const primary = { adapter: adapter("anthropic", () => Promise.reject(new Error("caiu"))), models: modelsOf("claude-haiku-5-5") };
    const fallback = { adapter: adapter("openai", async () => '{"ok":true}', { input_tokens: 50, output_tokens: 7 }), models: modelsOf("gpt-sem-preco") };
    const out = await withUsage(createLlm(primary, fallback), (u) => events.push(u)).extract({ ...REQ, task: "draft" });
    expect(out).toEqual({ ok: true });
    expect(events).toEqual([
      { task: "draft", input_tokens: 0, output_tokens: 0, cost_usd: 0 },
      { task: "draft", input_tokens: 50, output_tokens: 7, cost_usd: null },
    ]);
  });

  it("resposta inválida também conta (o provedor cobrou os tokens)", async () => {
    const events: LlmUsage[] = [];
    const base = createLlm({ adapter: adapter("anthropic", async () => "não é json"), models: modelsOf("claude-haiku-5-5") }, null);
    expect(await withUsage(base, (u) => events.push(u)).extract(REQ)).toBeNull();
    expect(events).toHaveLength(1);
    expect(events[0]!.input_tokens).toBe(700);
  });

  it("sink com erro não muda o resultado; o onUsage do próprio pedido também recebe", async () => {
    const own = vi.fn();
    const base = createLlm({ adapter: adapter("anthropic", async () => '{"ok":true}'), models: modelsOf("claude-haiku-5-5") }, null);
    const llm = withUsage(base, () => {
      throw new Error("medidor caiu");
    });
    expect(await llm.extract({ ...REQ, onUsage: own })).toEqual({ ok: true });
    // O erro do sink interrompe a cadeia dentro do try do client; o resultado continua o mesmo.
    const ok = withUsage(base, () => undefined);
    await ok.extract({ ...REQ, onUsage: own });
    expect(own).toHaveBeenCalledWith({ task: "intent", input_tokens: 700, output_tokens: 100, cost_usd: 0.00012 });
  });

  it("o registro técnico continua igual (sem tenant, sem texto) com o medidor ligado", async () => {
    const log = vi.fn();
    const base = createLlm({ adapter: adapter("anthropic", async () => '{"ok":true}'), models: modelsOf("claude-haiku-5-5") }, null, { log });
    await withUsage(base, () => undefined).extract(REQ);
    const raw = JSON.stringify(log.mock.calls);
    expect(raw).not.toMatch(/Augusta|01310|cliente 1/);
    expect(log.mock.calls[0]![0]).toMatchObject({ fn: "llm", task: "intent", cost_usd: 0.00012 });
  });
});
