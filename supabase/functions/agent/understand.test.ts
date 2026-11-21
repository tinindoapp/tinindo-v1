// Revisão 06/11 (T9b): frase com "por que"/"configurar/ajustar/mudar" que o motor levou a outra família vai ao modelo;
// a leitura só vale se o motor, rodando de novo, cair na família esperada. Sem provedor, nada muda.
import { describe, expect, it, vi } from "vitest";
import type { AgentContext, AgentData } from "../_shared/domain/agent/types.ts";
import { createLlm } from "../_shared/llm/client.ts";
import { noneLlm } from "../_shared/llm/index.ts";
import type { Adapter, LlmTask } from "../_shared/llm/types.ts";
import { understand } from "./understand.ts";

const NOW = new Date("2026-10-20T12:00:00Z");
const ctx: AgentContext = { tenant: { id: "10000000-0000-4000-8000-00000000000a", name: "Barbearia", timezone: "America/Sao_Paulo" }, role: "owner", now: NOW };
const data: AgentData = {
  directory: async () => ({ services: [], customers: [], customers_total: 0, pricing_rules: [], cancellation: null, waitlist: null, as_of: "2026-10-20T12:00:00Z" }),
  agenda: async (w) => ({ resource_id: null, timezone: "America/Sao_Paulo", as_of: "2026-10-20T12:00:00Z", bookings: [],
    days: [{ date: w.starts_at.slice(0, 10), open: [], blocks: [] }] }) as never,
  finance: async () => { throw new Error("não"); },
};
const empty = { customer: null, service: null, date: null, time: null, new_date: null, new_time: null, end_time: null, period: null, day_part: null, weekday: null, percent: null, source: null };
const models = Object.fromEntries((["intent", "setup", "draft", "explain"] as LlmTask[]).map((t) => [t, "claude-haiku-5-5"])) as Record<LlmTask, string>;
function llmSaying(reading: unknown) {
  const call = vi.fn(async () => ({ text: JSON.stringify(reading), refusal: false, truncated: false, usage: { input_tokens: 1, output_tokens: 1 } }));
  const adapter: Adapter = { provider: "anthropic", call };
  return { llm: createLlm({ adapter, models }, null), call };
}

describe("frases suspeitas vão ao modelo (T9b)", () => {
  it("'dá pra ajustar a agenda de amanhã?': o motor deu agenda; o modelo lê configuração de horários e vale", async () => {
    const { llm, call } = llmSaying({ ...empty, intent: "setup_help", topic: "hours" });
    const u = await understand("dá pra ajustar a agenda de amanhã?", ctx, data, llm);
    expect(call).toHaveBeenCalledTimes(1);
    expect(u.llm).toBe("used");
    expect(u.result.intent).toBe("setup_help");
    expect(u.result.text).toContain("/app/agenda/horarios");
  });

  it("leitura que não serve ('other') é descartada: fica a resposta do motor", async () => {
    const { llm } = llmSaying({ ...empty, intent: "other" });
    const u = await understand("dá pra ajustar a agenda de amanhã?", ctx, data, llm);
    expect(u.llm).toBe("discarded");
    expect(u.result.intent).toMatch(/^agenda/);
  });

  it("frase sem 'por que'/'ajustar' que o motor entende não chama o modelo", async () => {
    const { llm, call } = llmSaying({ ...empty, intent: "setup_help" });
    const u = await understand("minha agenda de amanhã", ctx, data, llm);
    expect(call).not.toHaveBeenCalled();
    expect(u.llm).toBe("none");
  });

  it("acima do teto de tokens: nem a frase suspeita chama o modelo", async () => {
    const { llm, call } = llmSaying({ ...empty, intent: "setup_help", topic: "hours" });
    const u = await understand("dá pra ajustar a agenda de amanhã?", ctx, data, llm, async () => false);
    expect(call).not.toHaveBeenCalled();
    expect(u.llm).toBe("over_limit");
  });

  it("sem provedor: igual ao motor", async () => {
    const u = await understand("dá pra ajustar a agenda de amanhã?", ctx, data, noneLlm);
    expect(u.llm).toBe("none");
  });
});
