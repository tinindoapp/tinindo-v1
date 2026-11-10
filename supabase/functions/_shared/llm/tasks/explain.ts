// Tarefa EXPLAIN (P45 + P46): uma frase simples que explica um insight a partir da evidência JÁ calculada pela regra.
// Ponto de integração: o P45 ainda não está na main. A frase não pode trazer número que não esteja na evidência;
// sem modelo (ou se trouxer), o P45 mostra o texto do modelo fixo.
import { z } from "zod";
import type { Llm } from "../types.ts";

export const Explanation = z.object({ sentence: z.string().trim().min(1).max(240) });

export interface Evidence {
  /** Título fixo da regra (ex.: "Horário ocioso recorrente"). */
  title: string;
  /** Números com rótulo, período e denominador, como a regra calculou. */
  facts: Record<string, string | number>;
}

export const EXPLAIN_SYSTEM = [
  "Explique em uma frase curta, em português do Brasil, para o dono de um pequeno negócio, o que a evidência mostra.",
  "Use só os números da evidência, sem arredondar nem calcular outros. Não prometa resultado. Devolva só o JSON do schema.",
].join("\n");

export async function explainInsight(llm: Llm, ev: Evidence): Promise<string | null> {
  if (!llm.enabled) return null;
  const input = JSON.stringify({ titulo: ev.title, evidencia: ev.facts });
  const r = await llm.extract({ task: "explain", system: EXPLAIN_SYSTEM, input, schema: Explanation, maxOutputTokens: 200 });
  if (!r) return null;
  const allowed = new Set(input.match(/\d+(?:[.,]\d+)?/g) ?? []);
  return (r.sentence.match(/\d+(?:[.,]\d+)?/g) ?? []).every((n) => allowed.has(n)) ? r.sentence : null;
}
