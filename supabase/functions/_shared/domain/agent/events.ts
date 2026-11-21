// Medição do assistente nas telas (revisão 06/11, T15): evento, superfície e quantos campos o assistente preencheu.
// Sem conteúdo: nunca o texto do dono, valores do formulário, nomes ou ids. Gravado por `assist.event` (função agent).
import { z } from "zod";
import { FORM_IDS } from "./forms.ts";

export const ASSIST_EVENTS = ["shown", "applied", "dismissed"] as const;
export const AssistEventName = z.enum(ASSIST_EVENTS);
export type AssistEventName = z.infer<typeof AssistEventName>;

export const ASSIST_SURFACES = [...FORM_IDS.map((f) => `form:${f}` as const), "draft", "explain"] as const;
export const AssistSurface = z.enum(ASSIST_SURFACES);
export type AssistSurface = z.infer<typeof AssistSurface>;

export const AssistEventInput = z.object({
  event: AssistEventName,
  surface: AssistSurface,
  /** Só em `applied` de formulário: quantos campos o assistente preencheu. */
  filled: z.int().min(0).max(20).nullable().default(null),
}).strict();
export type AssistEventInput = z.input<typeof AssistEventInput>;

export const AssistEventOutput = z.object({ recorded: z.boolean() });
