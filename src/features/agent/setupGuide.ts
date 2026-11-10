// "Me ajuda a configurar" (P46) conduz pelos passos do P44, um por vez, a partir de `setup.progress`.
//
// O P44 (configuração guiada) ainda não está na main. Este schema é a forma mínima que o guia lê, tirada do plano
// (docs/plano-assistente-configuracao-e-insights.md §3, P44): cada passo tem `done`, `why` e um link profundo.
// Quando o P44 publicar o contrato oficial em `@contracts`, trocar este schema pelo de lá. Cada confirmação grava
// pela tela normal do link (operações de sempre); o guia não grava nada.
import { z } from "zod";

export const SetupStep = z.object({
  code: z.string().min(1).max(40),
  title: z.string().min(1).max(80),
  done: z.boolean(),
  /** Passo opcional (foto, WhatsApp): o dono pode pular. */
  optional: z.boolean().default(false),
  why: z.string().max(240),
  /** Link profundo para a tela que resolve; sempre dentro do app. */
  href: z.string().regex(/^\/app(\/[a-z0-9\-/]*)?$/),
});
export type SetupStep = z.infer<typeof SetupStep>;

export const SetupProgress = z.object({
  steps: z.array(SetupStep).min(1).max(20),
});
export type SetupProgress = z.infer<typeof SetupProgress>;

/** Próximo passo a mostrar: o primeiro não feito e não pulado. */
export function nextStep(p: SetupProgress, skipped: ReadonlySet<string>): SetupStep | null {
  return p.steps.find((s) => !s.done && !skipped.has(s.code)) ?? null;
}

/** Progresso da demonstração: o negócio de exemplo já tem expediente, serviços e caixa; falta o resto. */
export const DEMO_SETUP: SetupProgress = {
  steps: [
    { code: "hours", title: "Expediente", done: true, optional: false, why: "Sem expediente, ninguém consegue marcar horário.", href: "/app/agenda/horarios" },
    { code: "services", title: "Serviços com duração e preço", done: true, optional: false, why: "A agenda e o preço usam a duração e o valor de cada serviço.", href: "/app/clientes/servicos" },
    { code: "cancellation", title: "Política de cancelamento", done: false, optional: false, why: "Deixa claro para o cliente o que acontece se ele desmarcar em cima da hora.", href: "/app/conta" },
    { code: "first_customer", title: "Primeiro cliente", done: true, optional: false, why: "Com clientes cadastrados, a agenda e o retorno ficam completos.", href: "/app/clientes" },
    { code: "public_profile", title: "Perfil publicado com link de horários", done: false, optional: false, why: "O link deixa o cliente escolher o horário sozinho.", href: "/app/perfil" },
    { code: "photo_whatsapp", title: "Foto e WhatsApp no perfil", done: false, optional: true, why: "Ajuda o cliente a reconhecer você. É opcional.", href: "/app/perfil" },
    { code: "channel", title: "Canal de mensagens verificado", done: false, optional: true, why: "Permite lembretes pelo canal oficial. Sem ele, os textos ficam prontos para você compartilhar.", href: "/app/mensagens" },
    { code: "cash", title: "Primeiro registro no caixa", done: true, optional: false, why: "O caixa mostra o que entrou e o que falta receber.", href: "/app/caixa" },
  ],
};
