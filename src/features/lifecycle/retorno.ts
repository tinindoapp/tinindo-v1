// Dados da aba Retorno (P49, decisão D2 b): quem não volta e o resumo da lista de espera. Os lembretes a mandar vêm do
// próprio Relacionamento (LifecyclePort.steps). Nada aqui grava: são leituras dos contratos que já existem.
// - Clientes e telefones: GET /crm/customers (customer.list).
// - Última visita e próximo horário: booking.list, pela conta de src/lib/visits.ts (customer.list não traz a data e
//   lifecycle.audience só devolve quem deu consentimento de marketing).
// - Lista de espera: waitlist.list. Falha nela não derruba a tela: o bloco mostra só o link.
import { ContextResponse, CRM_ROUTES, CustomerListOutput, WaitlistListOutput } from "@contracts";
import { FIXED_NOW, tenantA } from "@contracts/fixtures.ts";
import type { z } from "zod";
import type { createApiClient } from "../../lib/api/client.ts";
import { LOOKBACK_DAYS, readVisitSummary, type VisitSummary } from "../../lib/visits.ts";
import { DEMO_BUSINESS, DEMO_CUSTOMERS } from "./demoPort.ts";

export interface ReturnContact {
  id: string;
  name: string;
  phone: string | null;
}
export interface WaitlistSummary {
  /** Pessoas esperando vaga (ativas ou com oferta em aberto). */
  waiting: number;
  /** Vagas liberadas que servem a alguém e ainda não foram oferecidas. */
  openSlots: number;
}
export interface ReturnBoard {
  timezone: string;
  /** "Agora" da leitura: conta os dias desde a última visita. */
  now: string;
  business: string;
  customers: ReturnContact[];
  visits: VisitSummary;
  /** null: não deu para ler (ou demonstração, que não lê a lista de espera de outro módulo). */
  waitlist: WaitlistSummary | null;
}
export interface ReturnSource {
  readonly kind: "demo" | "server";
  board(): Promise<ReturnBoard>;
}

type Call = ReturnType<typeof createApiClient>;
const MAX_PAGES = 10;

export function summarizeWaitlist(data: z.infer<typeof WaitlistListOutput>): WaitlistSummary {
  return {
    waiting: data.entries.filter((e) => e.status === "active" || e.status === "offered").length,
    openSlots: data.candidates.filter((c) => c.status === "open").length,
  };
}

export function createServerReturnSource(call: Call, tenantId: string): ReturnSource {
  async function customers(): Promise<ReturnContact[]> {
    const out: ReturnContact[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const qs: string = new URLSearchParams({ limit: "100", ...(cursor ? { cursor } : {}) }).toString();
      const { data }: { data: z.infer<typeof CustomerListOutput> } = await call(`/crm/${CRM_ROUTES.listCustomers}?${qs}`, CustomerListOutput, { tenantId });
      out.push(...data.items.map((c) => ({ id: c.id, name: c.name, phone: c.phone })));
      cursor = data.next_cursor;
      if (!cursor) break;
    }
    return out;
  }
  return {
    kind: "server",
    async board() {
      const now = new Date();
      const ctx = (await call("/context", ContextResponse, { tenantId })).data;
      const [list, visits, waitlist] = await Promise.all([
        customers(),
        readVisitSummary(call, tenantId, ctx.timezone, now),
        call("/waitlist/waitlist.list", WaitlistListOutput, { method: "POST", tenantId, body: {} }).then((r) => summarizeWaitlist(r.data), () => null),
      ]);
      return { timezone: ctx.timezone, now: now.toISOString(), business: ctx.tenant_name, customers: list, visits, waitlist };
    },
  };
}

/** Demonstração: os clientes de exemplo do Relacionamento, com a última visita e o próximo horário deles. */
export function createDemoReturnSource(): ReturnSource {
  return {
    kind: "demo",
    async board() {
      const now = new Date(FIXED_NOW);
      const visits: VisitSummary = {
        since: new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000).toISOString(),
        complete: true,
        byCustomer: Object.fromEntries(DEMO_CUSTOMERS.map((c) => [c.id, { last_visit_at: c.last_visit_at, next_at: c.next_at }])),
      };
      return {
        timezone: tenantA.timezone,
        now: now.toISOString(),
        business: DEMO_BUSINESS,
        customers: DEMO_CUSTOMERS.map((c) => ({ id: c.id, name: c.name, phone: c.phone })),
        visits,
        waitlist: null,
      };
    },
  };
}
