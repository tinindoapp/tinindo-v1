// Porta real do Assistente: Edge Function `agent` (o banco decide vínculo, franquia, aprovação e execução).
import { ActionApproval, ActionReceipt, AgentAnswer } from "@contracts";
import type { createApiClient } from "../../lib/api/client.ts";
import type { AgentPort } from "./port.ts";

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
  };
}
