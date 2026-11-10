// Portas reais da Configuração: Edge Function `setup`.
import { SetupDismissOutput, SetupDraftApplyOutput, SetupProgressOutput, SetupServicesApplyOutput, SetupTemplatesOutput } from "@contracts";
import type { createApiClient } from "../../lib/api/client.ts";
import type { SetupPort } from "./port.ts";

type Call = ReturnType<typeof createApiClient>;
const op = (name: string) => `/setup/${name}`;

export function createServerPort(call: Call, tenantId: string): SetupPort {
  const post = (body: unknown, idempotencyKey?: string) => ({ method: "POST" as const, tenantId, body, idempotencyKey });
  return {
    kind: "server",
    async progress() {
      return (await call(op("setup.progress"), SetupProgressOutput, post({}))).data;
    },
    async dismiss(step, dismissed, key) {
      return (await call(op("setup.dismiss"), SetupDismissOutput, post({ step, dismissed }, key))).data.progress;
    },
    async templates() {
      return (await call(op("setup.templates"), SetupTemplatesOutput, post({}))).data;
    },
    async applyServices(services, key) {
      return (await call(op("setup.services_apply"), SetupServicesApplyOutput, post({ services }, key))).data;
    },
    async applyDraft(input, key) {
      return (await call(op("setup.draft_apply"), SetupDraftApplyOutput, post(input, key))).data;
    },
  };
}
