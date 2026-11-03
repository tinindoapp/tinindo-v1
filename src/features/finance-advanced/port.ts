// Portas do módulo Contas (P31). Demonstração: emulação na aba, sempre rotulada; servidor: Edge Function `finance-advanced`.
import type {
  AccCategory,
  AccCategorySaveInput,
  AccEntry,
  AccPayable,
  AccPayableSaveInput,
  AccReconciliationRow,
  AccSeries,
  AccStatement,
} from "@contracts";
import type { z } from "zod";

export type CategoryInput = z.input<typeof AccCategorySaveInput>;
export type PayableInput = z.input<typeof AccPayableSaveInput>;
export type { AccCategory, AccEntry, AccPayable, AccReconciliationRow, AccSeries, AccStatement };
export type Method = AccReconciliationRow["method"];
export type Source = AccReconciliationRow["source"];

export interface AccountsBase {
  timezone: string;
  /** Data local de hoje (AAAA-MM-DD), no fuso do negócio. */
  today: string;
}

export interface AccountsPort {
  readonly kind: "demo" | "server";
  base(): Promise<AccountsBase>;
  categories(): Promise<AccCategory[]>;
  saveCategory(input: CategoryInput, key: string): Promise<AccCategory>;
  classify(entry: AccEntry, categoryId: string | null, key: string): Promise<void>;
  entries(month: string): Promise<AccEntry[]>;
  payables(from: string, to: string): Promise<{ today: string; payables: AccPayable[]; series: AccSeries[] }>;
  savePayable(input: PayableInput, key: string): Promise<{ payable: AccPayable; created: number }>;
  pay(p: AccPayable, paidAt: string, key: string): Promise<AccPayable>;
  reverse(p: AccPayable, key: string): Promise<AccPayable>;
  cancel(p: AccPayable, key: string): Promise<AccPayable>;
  updateSeries(s: AccSeries, action: "extend" | "end", key: string): Promise<{ series: AccSeries; affected: number }>;
  reconciliation(day: string): Promise<AccReconciliationRow[]>;
  reconcile(day: string, method: Method, source: Source, statementCents: number, key: string): Promise<number>;
  statement(month: string): Promise<AccStatement>;
}

export const newKey = () => crypto.randomUUID();
