// Porta real: Edge Function `privacy` (exportar e eliminar) e a busca de clientes do CRM pelo contrato.
import { CustomerListOutput } from "@contracts";
import type { createApiClient } from "../../lib/api/client.ts";
import {
  PrivacyEraseOutput,
  PrivacyErasuresListOutput,
  PrivacyExportOutput,
  PrivacyExportsListOutput,
} from "../../../supabase/functions/privacy/contract.ts";
import type { PrivacyPort } from "./port.ts";

type Call = ReturnType<typeof createApiClient>;
const op = (name: string) => `/privacy/${name}`;

export function createServerPort(call: Call, tenantId: string): PrivacyPort {
  const post = (body: unknown, idempotencyKey?: string) => ({ method: "POST" as const, tenantId, body, idempotencyKey });
  return {
    kind: "server",
    async exports() {
      return (await call(op("privacy.exports"), PrivacyExportsListOutput, post({}))).data.items;
    },
    async exportData(input, key) {
      return (await call(op("privacy.export"), PrivacyExportOutput, post(input, key))).data;
    },
    async exportLink(exportId) {
      return (await call(op("privacy.export_link"), PrivacyExportOutput, post({ export_id: exportId }))).data;
    },
    async erasures() {
      return (await call(op("privacy.erasures"), PrivacyErasuresListOutput, post({}))).data.items;
    },
    async erase(input, key) {
      return (await call(op("privacy.erase"), PrivacyEraseOutput, post(input, key))).data.erasure;
    },
    async cancelErasure(erasureId, key) {
      return (await call(op("privacy.erase_cancel"), PrivacyEraseOutput, post({ erasure_id: erasureId }, key))).data.erasure;
    },
    async customers(q) {
      const qs = new URLSearchParams({ include_archived: "true", limit: "20", ...(q.trim() ? { q: q.trim() } : {}) });
      const out = (await call(`/crm/customer.list?${qs}`, CustomerListOutput, { tenantId })).data;
      return out.items.map((c) => ({ id: c.id, name: c.name }));
    },
  };
}
