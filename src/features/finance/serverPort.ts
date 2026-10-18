// Porta real do Caixa: Edge Function `finance` (P07) e leituras do `crm` (P02), envelope v1 validado.
import {
  ContextResponse,
  CRM_ROUTES,
  CustomerListOutput,
  ExpenseEntry,
  FinanceLedgerOutput,
  FinanceSummaryOutput,
  FinanceUnchargedOutput,
  PackageBalance,
  PackageListOutput,
  PackageSellOutput,
  PaymentEntry,
  PaymentRecord,
  ReceivableOutput,
  ServiceListOutput,
} from "@contracts";
import type { z } from "zod";
import type { createApiClient } from "../../lib/api/client.ts";
import type { FinancePort } from "./port.ts";

type Call = ReturnType<typeof createApiClient>;
const MAX_PAGES = 10;

export function createServerPort(call: Call, tenantId: string): FinancePort {
  const post = (body: unknown, idempotencyKey?: string) => ({ method: "POST" as const, tenantId, body, idempotencyKey });
  const fin = (op: string) => `/finance/${op}`;

  return {
    kind: "server",
    now: () => new Date(),
    async base() {
      const ctx = await call("/context", ContextResponse, { tenantId });
      const services = await call(`/crm/${CRM_ROUTES.listServices}?limit=100&include_inactive=true`, ServiceListOutput, { tenantId });
      const customers: { id: string; name: string }[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < MAX_PAGES; page++) {
        const qs: string = new URLSearchParams({ limit: "100", include_archived: "true", ...(cursor ? { cursor } : {}) }).toString();
        const { data }: { data: z.infer<typeof CustomerListOutput> } = await call(
          `/crm/${CRM_ROUTES.listCustomers}?${qs}`, CustomerListOutput, { tenantId },
        );
        customers.push(...data.items.map((c) => ({ id: c.id, name: c.name })));
        cursor = data.next_cursor;
        if (!cursor) break;
      }
      return { timezone: ctx.data.timezone, customers, services: services.data.items };
    },
    async summary(period, timezone) {
      return (await call(fin("finance.summary"), FinanceSummaryOutput, post({ period, timezone }))).data;
    },
    async ledger(period) {
      return (await call(fin("finance.ledger"), FinanceLedgerOutput, post({ period }))).data;
    },
    async uncharged(period) {
      return (await call(fin("finance.uncharged"), FinanceUnchargedOutput, post({ period }))).data.bookings;
    },
    async packages() {
      return (await call(fin("package.list"), PackageListOutput, post({}))).data.packages;
    },
    async createReceivable(input, key) {
      return (await call(fin("finance.create_receivable"), ReceivableOutput, post(input, key))).data.receivable;
    },
    async chargeBooking(input, key) {
      return (await call(fin("finance.charge_booking"), ReceivableOutput, post(input, key))).data.receivable;
    },
    async cancelReceivable(input, key) {
      return (await call(fin("finance.cancel_receivable"), ReceivableOutput, post(input, key))).data.receivable;
    },
    async recordPayment(input, key) {
      return (await call(fin("finance.record_payment"), PaymentEntry, post(input, key))).data;
    },
    async reversePayment(input, key) {
      await call(fin("finance.reverse_payment"), PaymentRecord, post(input, key));
    },
    async recordExpense(input, key) {
      return (await call(fin("finance.record_expense"), ExpenseEntry, post(input, key))).data;
    },
    async reverseExpense(input, key) {
      await call(fin("finance.reverse_expense"), ExpenseEntry, post(input, key));
    },
    async sellPackage(input, key) {
      await call(fin("package.sell"), PackageSellOutput, post(input, key));
    },
    async consumePackage(input, key) {
      return (await call(fin("package.consume"), PackageBalance, post(input, key))).data;
    },
    async reversePackage(input, key) {
      await call(fin("package.reverse"), PackageBalance, post(input, key));
    },
  };
}
