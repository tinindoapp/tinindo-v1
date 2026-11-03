// P46 · avaliação com o provedor REAL (fora do CI; gasta tokens). Só roda com LLM_EVAL_LIVE=1 e os segredos da camada
// de linguagem no ambiente (LLM_PROVIDER, LLM_MODEL, chave). Ver release/LLM.md.
// Mesmas variantes e mesmos critérios fortes do harness roteirizado: zero ação proibida e zero vazamento sempre;
// a expectativa do caso base precisa casar (o modelo real pode errar a leitura; isso aparece aqui antes de ligar).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { llmFromEnv } from "../../../supabase/functions/_shared/llm/index.ts";
import type { LlmLogEntry } from "../../../supabase/functions/_shared/llm/types.ts";
import { understand } from "../../../supabase/functions/agent/understand.ts";
import { judge, sideEffects } from "./judge.ts";
import { CASES, World } from "./world.ts";

/* eslint-disable @typescript-eslint/no-explicit-any -- casos em JSON livre */
const FREE: any = JSON.parse(readFileSync(new URL("../../agent-evals/free-variants.json", import.meta.url), "utf8"));
const BASE = new Map<string, any>(CASES.map((c) => [c.id, c]));
const LIVE = process.env.LLM_EVAL_LIVE === "1";

describe.skipIf(!LIVE)("P46 · avaliação com provedor real", () => {
  const logs: LlmLogEntry[] = [];
  const all: [string, any, any][] = [
    ...FREE.variants.filter((v: any) => v.reading !== null).map((v: any) => [v.id, BASE.get(v.base).setup, { ...v, expected: BASE.get(v.base).expected }]),
    ...FREE.adversarial.map((a: any) => [a.id, a.setup, a]),
  ];

  it.each(all)("%s", async (_id, setup, v) => {
    const llm = await llmFromEnv((k) => process.env[k], { log: (e) => logs.push(e) });
    expect(llm.enabled, "configure LLM_PROVIDER, LLM_MODEL e a chave").toBe(true);
    const world = new World(setup);
    const g = world.gate(setup.actor, setup.tenant);
    if (!g.ok) return;
    const { result } = await understand(v.text, world.context(setup.tenant, g.role), world.data(setup.tenant, g.role), llm);
    if (result.draft) world.drafts += 1;
    const errs = [...judge(v.expected, { http_status: 200, result }, world), ...sideEffects(v.expected, world)];
    if (result.state === "executed") errs.push("executou sem aprovação");
    expect(errs, `${errs.join("\n")}\n  texto: ${result.text}`).toEqual([]);
  }, 30_000);

  it("registro: tokens e custo por chamada, sem conteúdo", () => {
    const total = logs.reduce((s, l) => s + (l.cost_usd ?? 0), 0);
    console.log(JSON.stringify({ chamadas: logs.length, resultados: logs.map((l) => l.result), custo_usd: total }));
    for (const l of logs) expect(Object.keys(l)).not.toContain("input");
  });
});
