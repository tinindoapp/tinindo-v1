// Assistente, propostas de ação e aprovação vinculante (P08, docs/04 e 05).
// Aprovar ≠ executar ≠ enviar ≠ confirmar.
import { z } from "zod";
import { IsoDateTime, Uuid, Version } from "./common.ts";

/** Ferramentas permitidas ao agente no piloto. Lista fechada no servidor. */
export const AgentTool = z.enum([
  "agenda.read",
  "finance.summary",
  "pricing.propose_rule",
  "booking.create",
  "booking.reschedule",
  "booking.cancel",
  "waitlist.prepare_offer",
  "message.draft",
]);
export type AgentTool = z.infer<typeof AgentTool>;

export const ApprovalState = z.enum(["pending", "approved", "rejected", "expired", "invalidated", "executed"]);

/** Os cinco estados visíveis do agente (BRAND.md). */
export const AgentUiState = z.enum(["consulted", "recommendation", "pending_approval", "executed", "failed"]);

export const ActionProposal = z.object({
  proposal_id: Uuid,
  tenant_id: Uuid,
  tool: AgentTool,
  /** Payload normalizado exatamente como será executado. */
  payload: z.record(z.string(), z.unknown()),
  /** sha256 hex do payload normalizado + versão da política. */
  payload_hash: z.string().regex(/^[0-9a-f]{64}$/),
  policy_version: z.int().min(1),
  version: Version,
  expires_at: IsoDateTime,
  approval_state: ApprovalState,
  /** Resumo humano: destinatários, texto, desconto, custo estimado, horário. */
  summary: z.string().max(1000),
});
export type ActionProposal = z.infer<typeof ActionProposal>;

export const AgentAskInput = z.object({
  text: z.string().trim().min(1).max(2000),
  /** Contexto de tela opcional (IDs que o usuário está vendo). Dados, não instruções. */
  ui_context: z.record(z.string(), Uuid).optional(),
});
export const AgentAnswer = z.object({
  state: AgentUiState,
  text: z.string().max(4000),
  /** Objetos/consultas que sustentam a resposta. */
  sources: z.array(z.object({ kind: z.string().max(40), id: Uuid.nullable(), as_of: IsoDateTime })).max(50),
  proposal: ActionProposal.nullable(),
});

export const ActionApproveInput = z.object({
  proposal_id: Uuid,
  payload_hash: z.string().regex(/^[0-9a-f]{64}$/),
  expected_version: Version,
});
export const ActionApproval = z.object({
  approval_id: Uuid,
  proposal_id: Uuid,
  approver_user_id: Uuid,
  approved_at: IsoDateTime,
  expires_at: IsoDateTime,
});

export const ActionExecuteInput = z.object({
  approval_id: Uuid,
});
export const ActionReceipt = z.object({
  approval_id: Uuid,
  status: z.enum(["executed", "rejected_by_policy", "failed"]),
  result_ref: z.object({ kind: z.string().max(40), id: Uuid }).nullable(),
  executed_at: IsoDateTime,
});
