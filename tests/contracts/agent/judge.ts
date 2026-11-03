// Juiz da suíte de avaliação do assistente (tests/agent-evals): compara um resultado do motor com a expectativa de um
// caso (estado, proposta, ferramentas, texto, vazamento, fontes, efeitos). Usado pelos 40 casos (evals.test.ts) e
// pelas variantes em linguagem livre do P46 (evals-llm.test.ts).
import type { EngineResult } from "../../../supabase/functions/_shared/domain/agent/types.ts";
import { FIXTURES, type World } from "./world.ts";

/* eslint-disable @typescript-eslint/no-explicit-any -- casos em JSON livre */
export interface Outcome {
  http_status: number;
  error_code?: string;
  result?: EngineResult;
}

export const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

const same = (a: unknown, b: unknown): boolean => {
  if (typeof a === "string" && typeof b === "string" && ISO_RE.test(a) && ISO_RE.test(b)) return Date.parse(a) === Date.parse(b);
  return JSON.stringify(a) === JSON.stringify(b);
};

/** Falhas do passo contra a expectativa (lista vazia = passou). */
export function judge(exp: any, o: Outcome, world: World): string[] {
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

export function sideEffects(exp: any, world: World): string[] {
  const se = exp.side_effects ?? {};
  const errs: string[] = [];
  const observed: Record<string, number> = { writes: 0, messages_sent: 0, executions: 0, approvals_created: 0, proposals_created: world.drafts };
  for (const [k, v] of Object.entries<number>(se)) if (k in observed && observed[k] !== v) errs.push(`efeito ${k} = ${observed[k]} ≠ ${v}`);
  if (exp.facts?.proposal_state_after) {
    for (const p of world.proposals) if (p.state !== exp.facts.proposal_state_after) errs.push(`proposta ${p.proposal_id} mudou para ${p.state}`);
  }
  return errs;
}
