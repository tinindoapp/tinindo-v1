// Portas reais de Contas: Edge Function `finance-advanced` (+ `context` para o fuso).
import {
  AccCategoriesOutput,
  AccCategoryOutput,
  AccClassifyOutput,
  AccEntriesOutput,
  AccPayableOutput,
  AccPayableSaveOutput,
  AccPayablesOutput,
  AccReconcileSaveOutput,
  AccReconciliationOutput,
  AccSeriesUpdateOutput,
  AccStatementOutput,
  ContextResponse,
} from "@contracts";
import type { createApiClient } from "../../lib/api/client.ts";
import type { AccountsPort } from "./port.ts";
import { localToday } from "./labels.ts";

type Call = ReturnType<typeof createApiClient>;
const op = (name: string) => `/finance-advanced/${name}`;

export function createServerPort(call: Call, tenantId: string): AccountsPort {
  const post = (body: unknown, idempotencyKey?: string) => ({ method: "POST" as const, tenantId, body, idempotencyKey });
  const ref = (p: { id: string; version: number }) => ({ payable_id: p.id, expected_version: p.version });
  return {
    kind: "server",
    async base() {
      const ctx = await call("/context", ContextResponse, { tenantId });
      return { timezone: ctx.data.timezone, today: localToday(new Date(), ctx.data.timezone) };
    },
    async categories() {
      return (await call(op("accounts.categories"), AccCategoriesOutput, post({}))).data.categories;
    },
    async saveCategory(input, key) {
      return (await call(op("accounts.category_save"), AccCategoryOutput, post(input, key))).data.category;
    },
    async classify(entry, category_id, key) {
      await call(op("accounts.classify"), AccClassifyOutput, post({ entry_kind: entry.entry_kind, entry_id: entry.entry_id, category_id }, key));
    },
    async entries(month) {
      return (await call(op("accounts.entries"), AccEntriesOutput, post({ month }))).data.entries;
    },
    async payables(from, to) {
      return (await call(op("accounts.payables"), AccPayablesOutput, post({ from, to }))).data;
    },
    async savePayable(input, key) {
      const { data } = await call(op("accounts.payable_save"), AccPayableSaveOutput, post(input, key));
      return { payable: data.payable, created: data.created };
    },
    async pay(p, paid_at, key) {
      return (await call(op("accounts.payable_pay"), AccPayableOutput, post({ ...ref(p), paid_at }, key))).data.payable;
    },
    async reverse(p, key) {
      return (await call(op("accounts.payable_reverse"), AccPayableOutput, post(ref(p), key))).data.payable;
    },
    async cancel(p, key) {
      return (await call(op("accounts.payable_cancel"), AccPayableOutput, post(ref(p), key))).data.payable;
    },
    async updateSeries(s, action, key) {
      return (await call(op("accounts.series_update"), AccSeriesUpdateOutput, post({ series_id: s.id, expected_version: s.version, action }, key))).data;
    },
    async reconciliation(day) {
      return (await call(op("accounts.reconciliation"), AccReconciliationOutput, post({ day }))).data.rows;
    },
    async reconcile(day, method, source, statement_cents, key) {
      return (await call(op("accounts.reconcile_save"), AccReconcileSaveOutput, post({ day, method, source, statement_cents }, key))).data.reconciliation.difference_cents;
    },
    async statement(month) {
      return (await call(op("accounts.statement"), AccStatementOutput, post({ month }))).data;
    },
  };
}
