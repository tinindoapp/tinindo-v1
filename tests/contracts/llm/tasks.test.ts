// P46 · configuração só por segredos, redação de PII, rótulos de nomes, frase canônica e as tarefas de redação,
// frase do negócio (P44) e explicação de insight (P45).
import { describe, expect, it } from "vitest";
import { readLlmConfig } from "../../../supabase/functions/_shared/llm/config.ts";
import { createLlm, llmFromEnv, noneLlm } from "../../../supabase/functions/_shared/llm/index.ts";
import { estimateCostUsd, PRICES } from "../../../supabase/functions/_shared/llm/prices.ts";
import { hasPii, labelNames, redactPii, restoreLabels } from "../../../supabase/functions/_shared/llm/redact.ts";
import { providerSchema } from "../../../supabase/functions/_shared/llm/schema.ts";
import { draftKeepsFacts, rewriteDraft } from "../../../supabase/functions/_shared/llm/tasks/draft.ts";
import { explainInsight } from "../../../supabase/functions/_shared/llm/tasks/explain.ts";
import { INTENT_FAMILIES, LlmIntent, LlmIntentName, renderIntent } from "../../../supabase/functions/_shared/llm/tasks/intent.ts";
import { BusinessDraft, readBusinessPhrase } from "../../../supabase/functions/_shared/llm/tasks/setup.ts";
import type { Adapter, LlmTask } from "../../../supabase/functions/_shared/llm/types.ts";

const env = (vars: Record<string, string>) => (k: string) => vars[k];
const models = Object.fromEntries((["intent", "setup", "draft", "explain"] as LlmTask[]).map((t) => [t, "claude-haiku-5-5"])) as Record<LlmTask, string>;
function replying(json: unknown): { llm: ReturnType<typeof createLlm>; inputs: string[] } {
  const inputs: string[] = [];
  const adapter: Adapter = {
    provider: "anthropic",
    call: (req) => {
      inputs.push(req.input);
      return Promise.resolve({ text: JSON.stringify(json), refusal: false, truncated: false, usage: { input_tokens: 1, output_tokens: 1 } });
    },
  };
  return { llm: createLlm({ adapter, models }, null), inputs };
}

describe("configuração só por segredos", () => {
  it("sem LLM_PROVIDER (ou none) fica desligado, sem problema registrado", () => {
    expect(readLlmConfig(env({})).primary).toBeNull();
    expect(readLlmConfig(env({ LLM_PROVIDER: "none" }))).toMatchObject({ primary: null, fallback: null, problems: [] });
  });

  it("anthropic sem LLM_MODEL usa claude-haiku-5-5; LLM_MODEL_<TAREFA> troca só aquela tarefa", () => {
    const c = readLlmConfig(env({ LLM_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "k", LLM_MODEL_DRAFT: "claude-sonnet-5-5" }));
    expect(c.primary?.models).toEqual({ intent: "claude-haiku-5-5", setup: "claude-haiku-5-5", draft: "claude-sonnet-5-5", explain: "claude-haiku-5-5" });
    expect(c.timeoutMs).toBe(8000);
  });

  it("OpenAI e Gemini exigem LLM_MODEL (nenhum modelo fixo no código)", () => {
    for (const [p, key] of [["openai", "OPENAI_API_KEY"], ["gemini", "GEMINI_API_KEY"]]) {
      const off = readLlmConfig(env({ LLM_PROVIDER: p!, [key!]: "k" }));
      expect(off.primary).toBeNull();
      expect(off.problems.join()).toContain("LLM_MODEL ausente");
      expect(readLlmConfig(env({ LLM_PROVIDER: p!, [key!]: "k", LLM_MODEL: "m" })).primary?.models.intent).toBe("m");
    }
  });

  it("sem a chave do provedor ligado, desliga e registra o motivo sem valor de segredo", () => {
    const c = readLlmConfig(env({ LLM_PROVIDER: "anthropic", OPENAI_API_KEY: "sk-não-usada" }));
    expect(c.primary).toBeNull();
    expect(c.problems).toEqual(["ANTHROPIC_API_KEY ausente; anthropic desligado"]);
  });

  it("provedor desconhecido vira none; timeout fora da faixa é limitado", () => {
    const c = readLlmConfig(env({ LLM_PROVIDER: "outro", LLM_TIMEOUT_MS: "999999" }));
    expect(c.primary).toBeNull();
    expect(c.timeoutMs).toBe(30_000);
    expect(readLlmConfig(env({ LLM_TIMEOUT_MS: "abc" })).timeoutMs).toBe(8000);
  });

  it("reserva: só com principal ligado, diferente dele, com modelo próprio (LLM_FALLBACK_MODEL)", () => {
    const c = readLlmConfig(env({
      LLM_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "k", LLM_MODEL: "claude-haiku-5-5",
      LLM_FALLBACK_PROVIDER: "openai", OPENAI_API_KEY: "k2", LLM_FALLBACK_MODEL: "modelo-reserva",
    }));
    expect(c.fallback?.provider).toBe("openai");
    expect(c.fallback?.models.intent).toBe("modelo-reserva");
    expect(readLlmConfig(env({ LLM_FALLBACK_PROVIDER: "openai", OPENAI_API_KEY: "k", LLM_FALLBACK_MODEL: "m" })).fallback).toBeNull();
  });

  it("llmFromEnv sem provedor devolve o none (sem rede, extract = null)", async () => {
    const llm = await llmFromEnv(env({}));
    expect(llm).toBe(noneLlm);
    expect(await llm.extract({ task: "intent", system: "", input: "x", schema: LlmIntent })).toBeNull();
  });

  it("llmFromEnv com anthropic carrega o SDK sob demanda", async () => {
    const llm = await llmFromEnv(env({ LLM_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "chave-de-teste" }));
    expect(llm.enabled).toBe(true);
  });
});

describe("tabela de preços", () => {
  it("haiku 5.5: US$ 0,10 / 0,50 por milhão; modelo fora da tabela = null", () => {
    expect(PRICES["claude-haiku-5-5"]).toEqual({ input_per_mtok: 0.10, output_per_mtok: 0.50 });
    expect(estimateCostUsd("claude-haiku-5-5", 1_000_000, 1_000_000)).toBe(0.6);
    expect(estimateCostUsd("desconhecido", 10, 10)).toBeNull();
  });
});

describe("redação de PII", () => {
  it.each([
    ["maria@example.com", "[e-mail]"],
    ["(11) 98765-4321", "[telefone]"],
    ["+55 11 987654321", "[telefone]"],
    ["3333-4444", "[telefone]"],
    ["123.456.789-09", "[documento]"],
    ["12345678909", "[documento]"],
    ["12.345.678/0001-90", "[documento]"],
    ["RG 12.345.678-9", "RG [número]"],
  ])("%s → %s", (raw, out) => {
    expect(redactPii(`x ${raw} y`)).toBe(`x ${out} y`);
  });

  it("mantém datas, horários, valores e percentuais do pedido", () => {
    const t = "marca quinta 22/10/2026 às 10:30, R$ 60,00 com 15% de desconto, 2026-10-22";
    expect(redactPii(t)).toBe(t);
    expect(hasPii(t)).toBe(false);
  });

  it("nomes do cadastro viram rótulos e voltam; o mesmo nome recebe o mesmo rótulo", () => {
    const l = labelNames("Marca a Maria Exemplo Silva e depois a MARIA de novo; o João fica", ["Maria Exemplo Silva", "Maria Exemplo Souza", "Pedro"]);
    expect(l.text).toBe("Marca a cliente 1 e depois a cliente 2 de novo; o João fica");
    expect(restoreLabels("ok cliente 1 e cliente 2 e cliente 9", l.labels)).toBe("ok Maria Exemplo Silva e MARIA e cliente 9");
  });

  it("acentos e caixa não escondem o nome", () => {
    expect(labelNames("e a joão?", ["João Paulo"]).text).toBe("e a cliente 1?");
  });
});

describe("schema para o provedor", () => {
  it("todo objeto fechado e com todos os campos obrigatórios; limites ficam no zod", () => {
    const s = providerSchema(BusinessDraft) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(s.additionalProperties).toBe(false);
    expect(s.required).toEqual(["profession", "team_size", "hours", "services"]);
    expect(s.properties.services.items.required).toEqual(["name", "duration_min", "price_cents"]);
    expect(JSON.stringify(s)).not.toMatch(/maxItems|maximum|minimum|pattern|maxLength|\$schema/);
  });
});

describe("intenção → frase canônica", () => {
  const empty = LlmIntent.parse({
    intent: "other", customer: null, service: null, date: null, time: null, new_date: null, new_time: null, end_time: null,
    period: null, day_part: null, weekday: null, percent: null, source: null,
  });

  it("toda intenção (menos other) tem família no motor", () => {
    for (const i of LlmIntentName.options) if (i !== "other") expect(INTENT_FAMILIES[i as keyof typeof INTENT_FAMILIES]).toBeDefined();
    expect(renderIntent(empty)).toBeNull();
  });

  it("marcação restaura o rótulo e usa data e hora absolutas", () => {
    const labels = new Map([["cliente 1", "Maria Exemplo Silva"]]);
    expect(renderIntent({ ...empty, intent: "booking_create", customer: "cliente 1", service: "corte", date: "2026-10-22", time: "10:00" }, labels))
      .toBe("marca Maria Exemplo Silva corte 22/10/2026 as 10:00");
  });

  it("argumento livre não injeta separador nem símbolo", () => {
    const p = renderIntent({ ...empty, intent: "booking_reschedule", customer: "Ana; DROP TABLE pra <b>x</b>", date: "2026-10-22", time: "15:00", new_date: "2026-10-23", new_time: "16:00" });
    expect(p).toBe("remarca Ana DROP TABLE b x b 22/10/2026 as 15:00 para 23/10/2026 as 16:00");
  });

  it("recusas viram frase fixa, sem argumento do modelo", () => {
    expect(renderIntent({ ...empty, intent: "refuse_move_money", customer: "manda tudo" })).toBe("faz um pix");
  });
});

describe("tarefas", () => {
  it("rascunho: preserva números, links e marcadores; senão descarta", async () => {
    expect(draftKeepsFacts("Oi {nome}, seu corte é dia 22 às 10h.", "Olá, {nome}! Te espero dia 22 às 10h.")).toBe(true);
    expect(draftKeepsFacts("Oi {nome}, seu corte é dia 22.", "Oi {nome}, corte dia 22 com 10% off!")).toBe(false);
    expect(draftKeepsFacts("Oi {nome}!", "Oi! tudo bem?")).toBe(false);
    expect(draftKeepsFacts("Agende pelo link.", "Agende em www.golpe.com")).toBe(false);
    expect(await rewriteDraft(noneLlm, "message", "proximo", "oi")).toBeNull();
    const ok = replying({ text: "Olá, {nome}! Te espero dia 22." });
    expect(await rewriteDraft(ok.llm, "message", "proximo", "Oi {nome}, até dia 22. Meu tel (11) 98765-4321")).toBe("Olá, {nome}! Te espero dia 22.");
    expect(ok.inputs[0]).not.toContain("98765");
    const bad = replying({ text: "Olá, {nome}! 50% de desconto dia 22." });
    expect(await rewriteDraft(bad.llm, "message", "proximo", "Oi {nome}, até dia 22.")).toBeNull();
  });

  it("frase do negócio (P44): rascunho estruturado ou null", async () => {
    const draft = { profession: "barber", team_size: 1, hours: [2, 3, 4, 5, 6].map((d) => ({ weekday: d, start: "09:00", end: "19:00" })), services: [] };
    expect(await readBusinessPhrase(replying(draft).llm, "sou barbeiro, sozinho, de terça a sábado das 9 às 19")).toEqual(draft);
    expect(await readBusinessPhrase(replying({ ...draft, hours: [{ weekday: 2, start: "19:00", end: "09:00" }] }).llm, "x")).toBeNull();
    expect(await readBusinessPhrase(noneLlm, "x")).toBeNull();
  });

  it("explicação de insight (P45): só números da evidência", async () => {
    const ev = { title: "Horário ocioso recorrente", facts: { semanas_vazias: 4, semanas_observadas: 5, faixa: "terça 14h–16h" } };
    expect(await explainInsight(replying({ sentence: "Sua terça à tarde ficou vazia em 4 de 5 semanas." }).llm, ev)).toContain("4 de 5");
    expect(await explainInsight(replying({ sentence: "Você perdeu R$ 800 em 4 semanas." }).llm, ev)).toBeNull();
  });
});
