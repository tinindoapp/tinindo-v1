// Porta do Assistente (P08). Servidor: Edge Function `agent`. Demonstração: o MESMO motor sobre dados de exemplo.
import type { ActionApproval, ActionProposal, ActionReceipt, AgentAnswer } from "@contracts";
import type { z } from "zod";

export type Answer = z.infer<typeof AgentAnswer>;
export type Proposal = z.infer<typeof ActionProposal>;
export type Approval = z.infer<typeof ActionApproval>;
export type Receipt = z.infer<typeof ActionReceipt>;

export interface AgentPort {
  readonly kind: "demo" | "server";
  /** A mesma chave em retry não debita a franquia de novo. */
  ask(text: string, key: string): Promise<Answer>;
  /** Aprova o hash e a versão vistos. Não executa. */
  approve(proposal: Proposal, key: string): Promise<Approval>;
  /** Checa a política de novo e executa; repetir devolve o mesmo recibo. */
  execute(approvalId: string, key: string): Promise<Receipt>;
}

export const newKey = () => crypto.randomUUID();
