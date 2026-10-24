// Portas reais de Notas fiscais: Edge Function `fiscal`.
import { FiscalDocumentOutput, FiscalFolderOutput, FiscalOverview } from "@contracts";
import type { createApiClient } from "../../lib/api/client.ts";
import type { FiscalPort } from "./port.ts";

type Call = ReturnType<typeof createApiClient>;
const op = (name: string) => `/fiscal/${name}`;

export function createServerPort(call: Call, tenantId: string): FiscalPort {
  const post = (body: unknown, idempotencyKey?: string) => ({ method: "POST" as const, tenantId, body, idempotencyKey });
  const overview = async (name: string, body: unknown, key?: string) => (await call(op(name), FiscalOverview, post(body, key))).data;
  return {
    kind: "server",
    overview: () => overview("fiscal.get", {}),
    saveProfile: (draft, key) => overview("fiscal.profile_save", draft, key),
    grant: (terms_hash, key) => overview("fiscal.representation", { action: "grant", terms_hash }, key),
    revoke: (key) => overview("fiscal.representation", { action: "revoke" }, key),
    checkCredential: () => overview("fiscal.credential_check", {}),
    async emit(draft, key) {
      return (await call(op("fiscal.emit"), FiscalDocumentOutput, post(draft, key))).data.document;
    },
    async cancel(draft, key) {
      return (await call(op("fiscal.cancel"), FiscalDocumentOutput, post(draft, key))).data.document;
    },
    async folder(month) {
      return (await call(op("fiscal.folder"), FiscalFolderOutput, post({ month }))).data;
    },
  };
}
