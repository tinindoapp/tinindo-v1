// Tarefa "Faz comigo" (revisão 06/11/2026, T4): frase do dono → rascunho de um formulário do catálogo fechado
// (`_shared/domain/agent/forms.ts`). Usa o modelo da tarefa SETUP. O modelo só lê o texto e preenche uma forma fechada
// com campos anuláveis; as travas (limites do destino, dinheiro só se dito, sem marcador de dado redigido) e a
// validação pelo schema do formulário ficam em `buildFormDraft`. Nada é gravado por aqui.
import type { z } from "zod";
import { type BuiltDraft, buildFormDraft, FORM_SYSTEM, type FormId, LLM_FORM_SCHEMAS } from "../../domain/agent/forms.ts";
import { redactPii } from "../redact.ts";
import type { Llm } from "../types.ts";

/** Rascunho; null = desligado ou o modelo falhou (a tela segue com a dica fixa e o formulário). */
export async function readFormDraft(llm: Llm, form: FormId, text: string): Promise<BuiltDraft | null> {
  if (!llm.enabled) return null;
  const input = text.slice(0, 500);
  const read = await llm.extract({
    task: "setup",
    system: FORM_SYSTEM[form],
    input,
    schema: LLM_FORM_SCHEMAS[form] as z.ZodType<unknown>,
    maxOutputTokens: 600,
  });
  if (read === null) return null;
  // As travas conferem dinheiro contra o texto que de fato foi ao modelo (já sem telefone, e-mail, documento, CEP).
  return buildFormDraft(form, read, redactPii(input));
}
