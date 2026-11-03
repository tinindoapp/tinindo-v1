// Porta real do Assistente: Edge Function `agent` (o banco decide vínculo, franquia, aprovação e execução).
import { ActionApproval, ActionReceipt, AgentAnswer, AgentDraftOutput } from "@contracts";
import type { createApiClient } from "../../lib/api/client.ts";
import type { AgentPort } from "./port.ts";
import { SetupProgress } from "./setupGuide.ts";

type Call = ReturnType<typeof createApiClient>;

export function createServerPort(call: Call, tenantId: string): AgentPort {
  const post = (body: unknown, idempotencyKey: string) => ({ method: "POST" as const, tenantId, body, idempotencyKey });
  return {
    kind: "server",
    async ask(text, key) {
      return (await call("/agent/agent.ask", AgentAnswer, post({ text }, key))).data;
    },
    async approve(p, key) {
      return (await call("/agent/action.approve", ActionApproval,
        post({ proposal_id: p.proposal_id, payload_hash: p.payload_hash, expected_version: p.version }, key))).data;
    },
    async execute(approvalId, key) {
      return (await call("/agent/action.execute", ActionReceipt, post({ approval_id: approvalId }, key))).data;
    },
    async draft(req, key) {
      return (await call("/agent/agent.draft", AgentDraftOutput, post(req, key))).data;
    },
    async setupProgress() {
      // Função `setup` do P44. Enquanto ela não existir no servidor (ou falhar), o guia diz que não está disponível.
      try {
        return (await call("/setup/setup.progress", SetupProgress, { method: "POST", tenantId, body: {} })).data;
      } catch {
        return null;
      }
    },
  };
}
