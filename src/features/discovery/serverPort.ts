// Portas reais do Diretório: Edge Function `discovery`.
import { DirectoryCitiesOutput, DirectorySearchOutput, DiscoveryOverview } from "@contracts";
import type { createApiClient } from "../../lib/api/client.ts";
import type { DirectoryPort, DiscoveryPort } from "./port.ts";

type Call = ReturnType<typeof createApiClient>;
const op = (name: string) => `/discovery/${name}`;

export function createServerPort(call: Call, tenantId: string): DiscoveryPort {
  const post = (body: unknown, idempotencyKey?: string) => ({ method: "POST" as const, tenantId, body, idempotencyKey });
  return {
    kind: "server",
    async overview() {
      return (await call(op("discovery.get"), DiscoveryOverview, post({}))).data;
    },
    async save(draft, key) {
      return (await call(op("discovery.save"), DiscoveryOverview, post(draft, key))).data;
    },
  };
}

export function createServerDirectoryPort(call: Call): DirectoryPort {
  return {
    kind: "server",
    async search(q) {
      return (await call(op("directory.search"), DirectorySearchOutput, { method: "POST", body: q })).data;
    },
    async cities(category = null) {
      return (await call(op("directory.cities"), DirectoryCitiesOutput, { method: "POST", body: { category } })).data;
    },
  };
}
