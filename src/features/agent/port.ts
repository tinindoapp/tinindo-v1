// Porta do Assistente (P08). Servidor: Edge Function `agent`. Demonstração: o MESMO motor sobre dados de exemplo.
import type { ActionApproval, ActionProposal, ActionReceipt, AgentAnswer, AgentDraftInput, AgentDraftOutput } from "@contracts";
import type { z } from "zod";
import type { SetupProgress, SetupStepCode } from "@contracts";
import type { AssistEventInput } from "../../../supabase/functions/_shared/domain/agent/events.ts";
import type { FormDraftOutput, FormId } from "../../../supabase/functions/_shared/domain/agent/forms.ts";

export type FormDraftResult = FormDraftOutput;

export type Answer = z.infer<typeof AgentAnswer>;
export type Proposal = z.infer<typeof ActionProposal>;
export type Approval = z.infer<typeof ActionApproval>;
export type Receipt = z.infer<typeof ActionReceipt>;
export type DraftRequest = z.input<typeof AgentDraftInput>;
export type DraftResult = z.infer<typeof AgentDraftOutput>;

export interface AgentPort {
  readonly kind: "demo" | "server";
  /** A mesma chave em retry não debita a franquia de novo. */
  ask(text: string, key: string): Promise<Answer>;
  /** Aprova o hash e a versão vistos. Não executa. */
  approve(proposal: Proposal, key: string): Promise<Approval>;
  /** Checa a política de novo e executa; repetir devolve o mesmo recibo. */
  execute(approvalId: string, key: string): Promise<Receipt>;
  /** P46: reescreve um rascunho do dono no tom pedido. Sugestão editável; nada é salvo nem enviado. */
  draft(req: DraftRequest, key: string): Promise<DraftResult>;
  /** P44/P46: passos da configuração. null = configuração guiada ainda não disponível neste servidor. */
  setupProgress(): Promise<SetupProgress | null>;
  /**
   * P50: "Pular" um passo opcional, gravado por `setup.dismiss` (o mesmo "Agora não" da Home e da Configuração).
   * Devolve o progresso depois de dispensar. Passo obrigatório é recusado pelo servidor.
   */
  setupDismiss(step: SetupStepCode, key: string): Promise<SetupProgress>;
  /**
   * "Faz comigo" (revisão 06/11, T4): frase do dono → rascunho de um formulário do catálogo fechado. Nunca grava;
   * `available: false` = assistente desligado neste ambiente.
   */
  formDraft(form: FormId, text: string, key: string): Promise<FormDraftResult>;
  /** T15: medição sem conteúdo (faixa mostrada, rascunho aplicado, faixa dispensada). Nunca falha para a tela. */
  assistEvent(event: AssistEventInput): Promise<void>;
}

export const newKey = () => crypto.randomUUID();
