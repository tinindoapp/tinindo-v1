// Acesso a dados do módulo CRM. Servidor: Edge Function `crm` (envelope v1 validado na volta).
// Demonstração offline: fixtures sintéticas, somente leitura (nada é gravado, ADR-0006).
import { createContext, useContext } from "react";
import type { z } from "zod";
import { type Profession, type ProviderService, ServiceSaveInput, ServiceSaveOutput } from "@contracts";
import { FX, services as fixtureServices, tenantA } from "@contracts/fixtures.ts";
import {
  CRM_ROUTES,
  type CrmCustomer,
  type CrmCustomerUpsertInput,
  CrmCustomerUpsertOutput,
  CustomerArchiveOutput,
  CustomerListOutput,
  type ImportInput,
  ImportOutput,
  ImportPreviewOutput,
  ServiceListOutput,
} from "@contracts";
import { ApiError, type createApiClient } from "../../lib/api/client.ts";
import { fold } from "./format.ts";

export type ServiceSave = z.input<typeof ServiceSaveInput>;
export type PreviewRowInput = { line: number; name: string; phone: string | null; email: string | null };

export interface CrmApi {
  /** true = demonstração sem servidor: leitura de exemplo, gravação desabilitada. */
  readOnly: boolean;
  profession(): Promise<Profession>;
  listCustomers(q: { q?: string; include_archived?: boolean; cursor?: string; limit?: number }): Promise<CustomerListOutput>;
  upsertCustomer(input: CrmCustomerUpsertInput, idempotencyKey: string): Promise<z.infer<typeof CrmCustomerUpsertOutput>>;
  archiveCustomer(
    input: { customer_id: string; expected_version: number; archived: boolean },
    idempotencyKey: string,
  ): Promise<{ customer: CrmCustomer }>;
  listServices(q: { include_inactive?: boolean; cursor?: string }): Promise<ServiceListOutput>;
  saveService(input: ServiceSave, idempotencyKey: string): Promise<{ service: ProviderService }>;
  importPreview(rows: PreviewRowInput[]): Promise<ImportPreviewOutput>;
  importCustomers(rows: ImportInput["rows"], idempotencyKey: string): Promise<ImportOutput>;
}

type Call = ReturnType<typeof createApiClient>;

const qs = (params: Record<string, string | number | boolean | undefined>) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") s.set(k, String(v));
  const text = s.toString();
  return text ? `?${text}` : "";
};

export function createServerCrmApi(opts: {
  call: Call;
  tenantId: string;
  readProfession: () => Promise<Profession>;
}): CrmApi {
  const { call, tenantId } = opts;
  const path = (route: string) => `/crm/${route}`;
  const command = async <T extends z.ZodType>(route: string, schema: T, body: unknown, key: string) =>
    (await call(path(route), schema, { method: "POST", tenantId, body, idempotencyKey: key })).data;
  return {
    readOnly: false,
    profession: opts.readProfession,
    listCustomers: async (q) => (await call(path(CRM_ROUTES.listCustomers) + qs(q), CustomerListOutput, { tenantId })).data,
    listServices: async (q) => (await call(path(CRM_ROUTES.listServices) + qs(q), ServiceListOutput, { tenantId })).data,
    upsertCustomer: (input, key) => command(CRM_ROUTES.upsertCustomer, CrmCustomerUpsertOutput, input, key),
    archiveCustomer: (input, key) => command(CRM_ROUTES.archiveCustomer, CustomerArchiveOutput, input, key),
    saveService: (input, key) => command(CRM_ROUTES.saveService, ServiceSaveOutput, input, key),
    importCustomers: (rows, key) => command(CRM_ROUTES.importCustomers, ImportOutput, { rows }, key),
    importPreview: async (rows) =>
      (await call(path(CRM_ROUTES.importPreview), ImportPreviewOutput, { method: "POST", tenantId, body: { rows } })).data,
  };
}

/** Clientes sintéticos da demonstração (IDs de FX.customers; domínio exemplo.test). */
export const DEMO_CUSTOMERS: CrmCustomer[] = [
  {
    id: FX.customers.abInA, tenant_id: FX.tenants.A, name: "Cliente AB (exemplo)", phone: null,
    email: "cliente.ab@exemplo.test", declared_source: "referral", archived_at: null, version: 1,
  },
  {
    id: FX.customers.guestInA, tenant_id: FX.tenants.A, name: "Visitante sem login (exemplo)", phone: null,
    email: null, declared_source: "walk_in", archived_at: null, version: 1,
  },
];

const readOnlyError = () =>
  new ApiError("POLICY_REJECTED", "Demonstração sem servidor: nada é gravado.", 0, null, false);

export function createDemoCrmApi(): CrmApi {
  const customers = DEMO_CUSTOMERS;
  const services = fixtureServices.filter((s) => s.tenant_id === tenantA.id);
  return {
    readOnly: true,
    profession: async () => tenantA.profession,
    listCustomers: async ({ q, include_archived }) => {
      const needle = fold(q ?? "");
      return {
        items: customers.filter(
          (c) => (include_archived || !c.archived_at) && (!needle || fold(c.name).includes(needle)),
        ),
        next_cursor: null,
      };
    },
    listServices: async ({ include_inactive }) => ({
      items: services.filter((s) => include_inactive || s.active),
      next_cursor: null,
    }),
    importPreview: async (rows) => ({
      rows: rows.map((r) => ({
        line: r.line,
        matches: customers
          .map((c) => ({
            customer_id: c.id,
            name: c.name,
            reasons: [
              ...(r.phone && c.phone === r.phone ? (["phone"] as const) : []),
              ...(r.email && c.email === r.email ? (["email"] as const) : []),
              ...(fold(c.name) === fold(r.name) ? (["name"] as const) : []),
            ],
          }))
          .filter((m) => m.reasons.length > 0),
      })),
    }),
    upsertCustomer: async () => Promise.reject(readOnlyError()),
    archiveCustomer: async () => Promise.reject(readOnlyError()),
    saveService: async () => Promise.reject(readOnlyError()),
    importCustomers: async () => Promise.reject(readOnlyError()),
  };
}

export const CrmApiContext = createContext<CrmApi | null>(null);

export function useCrmApi(): CrmApi {
  const api = useContext(CrmApiContext);
  if (!api) throw new Error("useCrmApi fora do CrmApiContext");
  return api;
}

/** Mensagem para a pessoa: o servidor já devolve texto neutro em português. */
export function errorMessage(e: unknown): string {
  return e instanceof ApiError ? e.message : "Erro inesperado. Tente novamente.";
}

/**
 * Mesma chave enquanto o pedido for o mesmo (retry seguro); chave nova quando o conteúdo muda.
 */
export function createKeyRing() {
  let last: { payload: string; key: string } | null = null;
  return {
    keyFor(payload: unknown): string {
      const text = JSON.stringify(payload);
      if (last?.payload !== text) last = { payload: text, key: crypto.randomUUID() };
      return last.key;
    },
    /** Depois de sucesso: o próximo pedido, mesmo idêntico, é outra operação. */
    reset() {
      last = null;
    },
  };
}
