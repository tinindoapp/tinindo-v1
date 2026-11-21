// Schemas da rota `insight.explain` da Edge Function `growth-advice` ("Por quê?" nos insights, T3 da revisão de 04/11).
// Ficam fora de `_shared/contracts` como o `setup.describe` do P50 nasceu: a rota não é "uma RPC" e não entra no
// registro v1 até o integrador decidir registrá-la (ver o handler). É uma CONSULTA: sem Idempotency-Key.
import { z } from "zod";
import { Uuid } from "../../contracts/common.ts";

export const InsightExplainInput = z.object({ insight_id: Uuid });
export const InsightExplainOutput = z.object({
  insight_id: Uuid,
  /** Versão do insight que a frase explica (o motor diário sobe a versão quando recalcula). */
  version: z.int().min(1),
  text: z.string().min(1).max(400),
  /** assistant: frase do modelo (guardada por versão); fixed: frase fixa por regra, sem modelo. */
  source: z.enum(["assistant", "fixed"]),
});
export type InsightExplanation = z.infer<typeof InsightExplainOutput>;

export const INSIGHT_EXPLAIN = { name: "insight.explain", input: InsightExplainInput, output: InsightExplainOutput } as const;
