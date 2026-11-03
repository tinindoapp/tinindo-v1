// Schema zod da tarefa → JSON Schema para a saída estruturada do provedor.
//
// Mandamos ao provedor só a FORMA (tipos, enums, campos obrigatórios, sem campos extras). Limites como tamanho,
// faixa e padrão ficam no zod, que valida de novo toda resposta: os três provedores aceitam subconjuntos diferentes
// de JSON Schema, e um limite que um deles não conhece viraria erro 400 em vez de resposta.
import { z } from "zod";

const KEEP = new Set(["type", "enum", "const", "properties", "required", "additionalProperties", "items", "anyOf", "description"]);

function shape(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(shape);
  if (!node || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (!KEEP.has(k)) continue;
    if (k === "properties" && v && typeof v === "object") {
      out[k] = Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([p, s]) => [p, shape(s)]));
    } else {
      out[k] = shape(v);
    }
  }
  // Modo estrito (OpenAI) e saída estruturada (Anthropic): todo objeto fechado e com todos os campos obrigatórios.
  // Por isso os schemas das tarefas usam `.nullable()`, nunca `.optional()`.
  if (out.type === "object" && out.properties && typeof out.properties === "object") {
    out.additionalProperties = false;
    out.required = Object.keys(out.properties as Record<string, unknown>);
  }
  return out;
}

/** JSON Schema só com a forma, fechado e com todos os campos obrigatórios. */
export function providerSchema(schema: z.ZodType): Record<string, unknown> {
  return shape(z.toJSONSchema(schema)) as Record<string, unknown>;
}
