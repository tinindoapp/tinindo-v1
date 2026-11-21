// P32 bloco 1 · porta da medição de uso do app (fora do registro v1: rotas em supabase/functions/analytics/usage.ts).
import type { createApiClient } from "../../lib/api/client.ts";
import { DEFAULT_MESSAGES, ERROR_STATUS, RETRYABLE } from "@contracts";
import { ApiError } from "../../lib/api/client.ts";
import { UsageSettings as UsageSettingsSchema } from "../../../supabase/functions/analytics/usage.ts";

type Call = ReturnType<typeof createApiClient>;

export interface UsageSettings {
  enabled: boolean;
  version: number;
  retention_days: number;
}

export interface UsagePort {
  readonly kind: "demo" | "server";
  settings(): Promise<UsageSettings>;
  set(enabled: boolean, expectedVersion: number, key: string): Promise<UsageSettings>;
}

export function createServerUsagePort(call: Call, tenantId: string): UsagePort {
  const post = (body: unknown, idempotencyKey?: string) => ({ method: "POST" as const, tenantId, body, idempotencyKey });
  return {
    kind: "server",
    async settings() {
      return (await call("/analytics/usage.settings", UsageSettingsSchema, post({}))).data;
    },
    async set(enabled, expectedVersion, key) {
      return (await call("/analytics/usage.settings_set", UsageSettingsSchema, post({ enabled, expected_version: expectedVersion }, key))).data;
    },
  };
}

// Demonstração: só a preferência na memória da aba; nada é medido nem enviado.
let demo: UsageSettings = { enabled: true, version: 0, retention_days: 30 };
/** Só para testes. */
export function resetDemoUsage() {
  demo = { enabled: true, version: 0, retention_days: 30 };
}
export function createDemoUsagePort(): UsagePort {
  return {
    kind: "demo",
    async settings() {
      return { ...demo };
    },
    async set(enabled, expectedVersion) {
      if (expectedVersion !== demo.version) {
        throw new ApiError("STALE_VERSION", DEFAULT_MESSAGES.STALE_VERSION, ERROR_STATUS.STALE_VERSION, null, RETRYABLE.has("STALE_VERSION"));
      }
      demo = { ...demo, enabled, version: demo.version + 1 };
      return { ...demo };
    },
  };
}
