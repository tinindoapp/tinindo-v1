// Acesso a dados do módulo CRM. Servidor: Edge Function `crm` (envelope v1 validado na volta).
// Demonstração offline: fixtures sintéticas, somente leitura (nada é gravado, ADR-0006).
import { createContext, useContext } from "react";
import type { z } from "zod";
import { type Profession, type ProviderService, ServiceSaveInput, ServiceSaveOutput } from "@contracts";
import { FX, services as fixtureServices, tenantA } from "@contracts/fixtures.ts";
import {
  BookingListOutput,
  type BookingStatus,
  ContextResponse,
  CRM_ROUTES,
  type CrmCustomer,
  type CrmCustomerUpsertInput,
  CrmCustomerUpsertOutput,
  CustomerArchiveOutput,
  CustomerGetOutput,
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

/** Um atendimento no histórico da ficha (leitura da agenda, só do cliente aberto). */
export interface HistoryItem {
  id: string;
  starts_at: string;
  service: string;
  status: BookingStatus;
  price_cents: number | null;
}
/** Histórico da ficha: atendimentos que começam entre `from` e `until`, no fuso do negócio. */
export interface CustomerHistory {
  timezone: string;
  now: string;
  items: HistoryItem[];
  /** false quando a leitura parou no teto de páginas: há atendimentos mais antigos que não vieram. */
  complete: boolean;
}

export interface CrmApi {
  /** true = demonstração sem servidor: leitura de exemplo, gravação desabilitada. */
  readOnly: boolean;
  profession(): Promise<Profession>;
  listCustomers(q: { q?: string; include_archived?: boolean; cursor?: string; limit?: number }): Promise<CustomerListOutput>;
  /** Ficha do cliente; null quando não existe neste negócio. */
  getCustomer(id: string): Promise<CrmCustomer | null>;
  /** Todos os atendimentos do cliente na agenda (anteriores e próximos), do mais recente para o mais antigo. */
  customerHistory(customerId: string): Promise<CustomerHistory>;
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

/** Teto de páginas por leitura de lista (100 itens cada): protege a tela de laço infinito. */
const MAX_PAGES = 10;

/** Mais recentes primeiro (os próximos em cima, depois os anteriores). */
const byStartDesc = (a: HistoryItem, b: HistoryItem) => Date.parse(b.starts_at) - Date.parse(a.starts_at);

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
  const listCustomers: CrmApi["listCustomers"] = async (q) =>
    (await call(path(CRM_ROUTES.listCustomers) + qs(q), CustomerListOutput, { tenantId })).data;
  return {
    readOnly: false,
    profession: opts.readProfession,
    listCustomers,
    // Leitura por id (customer.get), arquivados inclusive. Id de outro negócio ou inexistente → null.
    getCustomer: async (id) => {
      try {
        return (await call(path(CRM_ROUTES.getCustomer) + qs({ customer_id: id }), CustomerGetOutput, { tenantId })).data.customer;
      } catch (e) {
        if (e instanceof ApiError && e.code === "NOT_FOUND") return null;
        throw e;
      }
    },
    // Histórico inteiro pela agenda (booking.list_by_customer): páginas de 100, do mais recente para o mais antigo.
    customerHistory: async (customerId) => {
      const post = (body: unknown) => ({ method: "POST" as const, tenantId, body });
      const visits = async () => {
        const out = [];
        let cursor: string | undefined;
        for (let page = 0; page < MAX_PAGES; page++) {
          const { data } = await call("/scheduling/booking.list_by_customer", BookingListOutput, post({ customer_id: customerId, cursor, limit: 100 }));
          out.push(...data.bookings);
          if (!data.next_cursor) return { items: out, complete: true };
          cursor = data.next_cursor;
        }
        return { items: out, complete: false };
      };
      const [ctx, services, all] = await Promise.all([
        call("/context", ContextResponse, { tenantId }),
        call(path(CRM_ROUTES.listServices) + qs({ include_inactive: true, limit: 100 }), ServiceListOutput, { tenantId }),
        visits(),
      ]);
      const names = new Map(services.data.items.map((s) => [s.id, s.name]));
      return {
        timezone: ctx.data.timezone,
        now: new Date().toISOString(),
        complete: all.complete,
        items: all.items
          .filter((b) => b.status !== "expired")
          .map((b) => ({ id: b.id, starts_at: b.starts_at, service: names.get(b.service_id) ?? "Atendimento", status: b.status, price_cents: b.agreed_price_cents }))
          .sort(byStartDesc),
      };
    },
    listServices: async (q) => (await call(path(CRM_ROUTES.listServices) + qs(q), ServiceListOutput, { tenantId })).data,
    upsertCustomer: (input, key) => command(CRM_ROUTES.upsertCustomer, CrmCustomerUpsertOutput, input, key),
    archiveCustomer: (input, key) => command(CRM_ROUTES.archiveCustomer, CustomerArchiveOutput, input, key),
    saveService: (input, key) => command(CRM_ROUTES.saveService, ServiceSaveOutput, input, key),
    importCustomers: (rows, key) => command(CRM_ROUTES.importCustomers, ImportOutput, { rows }, key),
    importPreview: async (rows) =>
      (await call(path(CRM_ROUTES.importPreview), ImportPreviewOutput, { method: "POST", tenantId, body: { rows } })).data,
  };
}

/** Clientes sintéticos da demonstração (IDs de FX.customers; domínio exemplo.test). Um com telefone (o mesmo do Canal de
 *  exemplo) e outro sem, para a lista mostrar os dois casos. */
export const DEMO_CUSTOMERS: CrmCustomer[] = [
  {
    id: FX.customers.abInA, tenant_id: FX.tenants.A, name: "Cliente AB (exemplo)", phone: "+5511988887777",
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
    getCustomer: async (id) => customers.find((c) => c.id === id) ?? null,
    // Histórico inteiro da base de exemplo única (src/lib/demo/dataset.ts), em volta do "agora" fixo.
    customerHistory: async (customerId) => {
      // Carregada só quando a ficha abre: a base de exemplo não entra no pacote da lista de clientes.
      const { DEMO_SERVICES, DEMO_TZ, demoNow, demoVisits } = await import("../../lib/demo/dataset.ts");
      return {
        timezone: DEMO_TZ,
        now: demoNow().toISOString(),
        complete: true,
        items: demoVisits()
          .filter((v) => v.customer_id === customerId && v.status !== "expired")
          .map((v) => ({ id: v.id, starts_at: v.starts_at, service: DEMO_SERVICES[v.service_id]?.name ?? "Atendimento", status: v.status, price_cents: v.agreed_price_cents }))
          .sort(byStartDesc),
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
