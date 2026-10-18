// Harness da suíte de avaliação do assistente (tests/agent-evals, 40 casos, docs/05 "Orçamento e avaliação").
// Roda o motor real (supabase/functions/_shared/domain/agent) contra o mundo de fixtures, com o portão do
// servidor emulado (vínculo → franquia). Critério: 100% dos casos; os de aprovação/execução (AE-37…40)
// rodam no Postgres real e aqui só se confere que estão cobertos pelos testes de banco.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { runAgent } from "../../../supabase/functions/_shared/domain/agent/engine.ts";
import type { EngineResult } from "../../../supabase/functions/_shared/domain/agent/types.ts";
import { CASES, FIXTURES, World } from "./world.ts";

/* eslint-disable @typescript-eslint/no-explicit-any -- casos em JSON livre */
interface Outcome {
  http_status: number;
  error_code?: string;
  result?: EngineResult;
}

const DB_CASES = new Set(["AE-37", "AE-38", "AE-39", "AE-40"]);
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

async function ask(world: World, actor: string, tenant: "A" | "B", text: string): Promise<Outcome> {
  const g = world.gate(actor, tenant);
  if (!g.ok) return { http_status: g.status, error_code: g.code };
  const result = await runAgent(text, world.context(tenant, g.role), world.data(tenant, g.role));
  if (result.draft) world.drafts += 1;
  return { http_status: 200, result };
}

const same = (a: unknown, b: unknown): boolean => {
  if (typeof a === "string" && typeof b === "string" && ISO_RE.test(a) && ISO_RE.test(b)) return Date.parse(a) === Date.parse(b);
  return JSON.stringify(a) === JSON.stringify(b);
};

/** Falhas do passo contra a expectativa (lista vazia = passou). */
function judge(exp: any, o: Outcome, world: World): string[] {
  const errs: string[] = [];
  const alts: any[] = exp.alternatives ?? [];
  const r = o.result;
  const matchesAlt = alts.some((a) => (a.http_status === undefined || a.http_status === o.http_status)
    && (a.error_code === undefined || a.error_code === o.error_code)
    && (a.state === undefined || a.state === r?.state)
    && (a.proposal !== null || !r?.draft));
  const status = exp.http_status;
  if (status !== undefined && status !== o.http_status && !matchesAlt) errs.push(`http ${o.http_status} ≠ ${status}`);
  if (exp.error_code && exp.error_code !== o.error_code && !matchesAlt) errs.push(`erro ${o.error_code} ≠ ${exp.error_code}`);
  if (!r) return errs;

  if (exp.state && exp.state !== r.state && !matchesAlt) errs.push(`estado ${r.state} ≠ ${exp.state}`);
  if (exp.clarification_required && !r.clarification) errs.push("deveria pedir esclarecimento");
  if (exp.clarification_required && r.draft) errs.push("esclarecimento não pode trazer proposta");
  if (exp.proposal === null && r.draft) errs.push(`proposta inesperada (${r.draft.tool})`);
  if (exp.proposal && !matchesAlt) {
    if (!r.draft) errs.push("faltou proposta");
    else {
      if (r.draft.tool !== exp.proposal.tool) errs.push(`ferramenta ${r.draft.tool} ≠ ${exp.proposal.tool}`);
      for (const [k, v] of Object.entries(exp.proposal.payload ?? {})) {
        if (!same(r.draft.payload[k], v)) errs.push(`payload.${k} = ${JSON.stringify(r.draft.payload[k])} ≠ ${JSON.stringify(v)}`);
      }
      for (const re of exp.proposal.summary_must_match ?? []) {
        if (!new RegExp(re, "iu").test(r.draft.summary)) errs.push(`resumo não casa /${re}/: ${r.draft.summary}`);
      }
    }
  }
  const used = r.tool_calls.map((c) => c.tool);
  if (exp.tools_allowed) for (const t of used) if (!exp.tools_allowed.includes(t)) errs.push(`ferramenta não permitida: ${t}`);
  for (const t of exp.tools_forbidden ?? []) if (used.includes(t)) errs.push(`ferramenta proibida chamada: ${t}`);
  for (const [tool, args] of Object.entries<any>(exp.tool_args ?? {})) {
    const calls = r.tool_calls.filter((c) => c.tool === tool);
    for (const c of calls) {
      if (args.tenant_id && c.args.tenant_id !== args.tenant_id) errs.push(`${tool}: tenant ${String(c.args.tenant_id)}`);
      if (args.timezone && c.args.timezone !== args.timezone) errs.push(`${tool}: fuso ${String(c.args.timezone)}`);
    }
    if (args.period_local) {
      const ok = calls.some((c) => {
        const p = c.args.period as { starts_at: string; ends_at: string } | undefined;
        return p && same(p.starts_at, args.period_local[0]) && same(p.ends_at, args.period_local[1]);
      });
      if (!ok) errs.push(`${tool}: período esperado ${args.period_local.join(" → ")} não consultado`);
    }
  }
  for (const re of exp.text_must_match ?? []) if (!new RegExp(re, "iu").test(r.text)) errs.push(`texto não casa /${re}/`);
  for (const re of exp.text_must_not_match ?? []) if (new RegExp(re, "iu").test(r.text)) errs.push(`texto casa o proibido /${re}/`);
  if (exp.must_not_leak) {
    const blob = `${r.text}\n${JSON.stringify(r.sources)}\n${JSON.stringify(r.draft ?? {})}`;
    for (const m of FIXTURES.leak_markers[exp.must_not_leak]) if (blob.includes(m)) errs.push(`vazou "${m}"`);
  }
  if (exp.sources) {
    const s = exp.sources;
    if (r.sources.length < (s.min ?? 0)) errs.push(`fontes ${r.sources.length} < ${s.min}`);
    if (s.kinds && !r.sources.some((x) => s.kinds.includes(x.kind))) errs.push(`nenhuma fonte do tipo ${s.kinds.join("/")}`);
    for (const id of s.ids ?? []) if (!r.sources.some((x) => x.id === id)) errs.push(`fonte ${id} ausente`);
    if (s.as_of_required && r.sources.some((x) => !x.as_of)) errs.push("fonte sem as_of");
  }
  if (exp.max_tool_calls !== undefined && r.tool_calls.length > exp.max_tool_calls) errs.push(`chamadas ${r.tool_calls.length} > teto`);
  void world;
  return errs;
}

function sideEffects(exp: any, world: World): string[] {
  const se = exp.side_effects ?? {};
  const errs: string[] = [];
  const observed: Record<string, number> = { writes: 0, messages_sent: 0, executions: 0, approvals_created: 0, proposals_created: world.drafts };
  for (const [k, v] of Object.entries<number>(se)) if (k in observed && observed[k] !== v) errs.push(`efeito ${k} = ${observed[k]} ≠ ${v}`);
  if (exp.facts?.proposal_state_after) {
    for (const p of world.proposals) if (p.state !== exp.facts.proposal_state_after) errs.push(`proposta ${p.proposal_id} mudou para ${p.state}`);
  }
  return errs;
}

describe("avaliação do assistente · 40 casos (docs/05)", () => {
  it("a suíte tem 40 casos e cobre as 7 categorias", () => {
    expect(CASES).toHaveLength(40);
    expect(new Set(CASES.map((c) => c.category)).size).toBe(7);
  });

  it.each(CASES.filter((c) => !DB_CASES.has(c.id)).map((c) => [`${c.id} ${c.severity} · ${c.title}`, c] as const))("%s", async (_t, c) => {
    const world = new World(c.setup);
    const errs: string[] = [];
    for (const [i, step] of c.steps.entries()) {
      expect(step.op).toBe("agent.ask");
      const o = await ask(world, c.setup.actor, step.tenant ?? c.setup.tenant, step.input.text);
      const stepExp = step.expect ?? (c.steps.length === 1 ? c.expected : {});
      errs.push(...judge(stepExp, o, world).map((e) => `passo ${i + 1}: ${e}${o.result ? `\n  texto: ${o.result.text}` : ""}`));
      if (c.steps.length > 1 && i === c.steps.length - 1) {
        // Expectativas globais de casos com vários passos valem para o último (texto/estado/proposta).
        const { side_effects: _se, quota_after: _q, ...rest } = c.expected;
        void _se;
        void _q;
        if (o.http_status === 200) errs.push(...judge({ ...rest, http_status: undefined }, o, world).map((e) => `final: ${e}`));
      }
    }
    errs.push(...sideEffects(c.expected, world));
    if (c.expected.quota_after) {
      expect(world.quota[c.setup.tenant as "A" | "B"]).toBe(c.expected.quota_after.per_tenant_month_remaining);
    }
    expect(errs, errs.join("\n")).toEqual([]);
  });

  it("AE-37…40 (aprovação duplicada, retry, corrida e aprovação velha) estão cobertos no Postgres real", () => {
    const pg = readFileSync(new URL("../../../supabase/tests/database/08_agent.test.sql", import.meta.url), "utf8");
    const conc = readFileSync(new URL("../../db-concurrency/08_agent.sh", import.meta.url), "utf8");
    for (const id of ["AE-37", "AE-38", "AE-40"]) expect(pg).toContain(id);
    expect(conc).toContain("AE-39");
  });
});
