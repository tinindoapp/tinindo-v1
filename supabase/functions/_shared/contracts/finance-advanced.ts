// Financeiro ampliado (P31). Aditivos ao v1; ver ADR-0033.
// Contas a pagar (única ou mensal): pagar cria UMA despesa no Caixa (P07), pagar de novo é recusado, estorno uma vez.
// Categorias próprias de receita e despesa por cima do Caixa. Conciliação por meio de pagamento e origem (manual/PSP).
// Demonstrativo gerencial mensal em regime de caixa, com período escrito e cobertura. Não é DRE.
import { z } from "zod";
import { Cents, IsoDateTime, LocalDate, SignedCents, TimeZone, Uuid } from "./common.ts";
import { ExpenseCategory, PaymentMethod } from "./finance.ts";

export const AccCategoryKind = z.enum(["income", "expense"]);
export const AccCategory = z.object({
  id: Uuid,
  kind: AccCategoryKind,
  name: z.string().min(1).max(60),
  /** Despesa: categoria do Caixa em que entra. Receita: null. */
  base: ExpenseCategory.nullable(),
  active: z.boolean(),
  version: z.int().min(1),
});
export type AccCategory = z.infer<typeof AccCategory>;
export const AccCategoriesInput = z.object({});
export const AccCategoriesOutput = z.object({ categories: z.array(AccCategory).max(500) });
export const AccCategorySaveInput = z.object({
  category_id: Uuid.nullable().default(null),
  expected_version: z.int().min(1).nullable().default(null),
  kind: AccCategoryKind,
  name: z.string().trim().min(1).max(60),
  base: ExpenseCategory.nullable().default(null),
  active: z.boolean().default(true),
});
export const AccCategoryOutput = z.object({ category: AccCategory });

export const AccClassifyInput = z.object({
  entry_kind: z.enum(["payment", "expense"]),
  entry_id: Uuid,
  /** null tira a categoria própria (volta a de origem/do Caixa). */
  category_id: Uuid.nullable(),
});
export const AccClassifyOutput = z.object({ entry_kind: z.enum(["payment", "expense"]), entry_id: Uuid, category_id: Uuid.nullable() });

export const AccPayableStatus = z.enum(["open", "overdue", "paid", "cancelled"]);
export const AccPayable = z.object({
  id: Uuid,
  series_id: Uuid.nullable(),
  description: z.string(),
  amount_cents: Cents.min(1),
  due_on: LocalDate,
  base_category: ExpenseCategory,
  category_id: Uuid.nullable(),
  category_name: z.string().nullable(),
  supplier: z.string().nullable(),
  status: AccPayableStatus,
  paid_at: IsoDateTime.nullable(),
  expense_entry_id: Uuid.nullable(),
  /** Pagamentos estornados desta conta. */
  reversals: z.int().min(0),
  version: z.int().min(1),
});
export type AccPayable = z.infer<typeof AccPayable>;
export const AccSeries = z.object({
  id: Uuid,
  description: z.string(),
  amount_cents: Cents.min(1),
  base_category: ExpenseCategory,
  category_id: Uuid.nullable(),
  supplier: z.string().nullable(),
  day_of_month: z.int().min(1).max(28),
  starts_on: LocalDate,
  generated_until: LocalDate,
  active: z.boolean(),
  version: z.int().min(1),
});
export type AccSeries = z.infer<typeof AccSeries>;
export const AccPayablesInput = z.object({ from: LocalDate, to: LocalDate });
export const AccPayablesOutput = z.object({ today: LocalDate, payables: z.array(AccPayable).max(300), series: z.array(AccSeries).max(200) });

export const AccPayableSaveInput = z.object({
  /** null = nova conta. */
  payable_id: Uuid.nullable().default(null),
  expected_version: z.int().min(1).nullable().default(null),
  description: z.string().trim().min(1).max(120),
  amount_cents: Cents.min(1),
  due_on: LocalDate,
  base_category: ExpenseCategory.default("other"),
  category_id: Uuid.nullable().default(null),
  supplier: z.string().trim().max(80).nullable().default(null),
  /** Nova conta mensal: gera os próximos 12 meses (vencimento até o dia 28). */
  monthly: z.boolean().default(false),
});
export const AccPayableSaveOutput = z.object({ payable: AccPayable, series: AccSeries.nullable(), created: z.int().min(1) });
export const AccPayableOutput = z.object({ payable: AccPayable });
export const AccPayablePayInput = z.object({ payable_id: Uuid, expected_version: z.int().min(1), paid_at: IsoDateTime });
export const AccPayableRefInput = z.object({ payable_id: Uuid, expected_version: z.int().min(1) });
export const AccSeriesUpdateInput = z.object({ series_id: Uuid, expected_version: z.int().min(1), action: z.enum(["extend", "end"]) });
export const AccSeriesUpdateOutput = z.object({ series: AccSeries, affected: z.int().min(0) });

export const AccSource = z.enum(["manual", "provider"]);
export const AccStatementCheck = z.object({ statement_cents: Cents, ledger_cents: SignedCents, difference_cents: SignedCents, checked_at: IsoDateTime });
export const AccReconciliationRow = z.object({
  method: PaymentMethod,
  source: AccSource,
  /** Registrado na Tinindo no dia, líquido de estornos. */
  ledger_cents: SignedCents,
  entries: z.int().min(0),
  /** Origem PSP: o que o provedor diz que pagou no dia (cobranças do P14). */
  partner_paid_cents: Cents.nullable(),
  /** Origem PSP: diferenças da última conciliação do P14 no dia (null = não conciliado lá). */
  partner_differences: z.int().min(0).nullable(),
  /** Última conferência do extrato (a última vale). */
  statement: AccStatementCheck.nullable(),
});
export type AccReconciliationRow = z.infer<typeof AccReconciliationRow>;
export const AccReconciliationInput = z.object({ day: LocalDate });
export const AccReconciliationOutput = z.object({ day: LocalDate, timezone: TimeZone, rows: z.array(AccReconciliationRow).max(20) });
export const AccReconcileSaveInput = z.object({ day: LocalDate, method: PaymentMethod, source: AccSource, statement_cents: Cents });
export const AccReconcileSaveOutput = z.object({
  reconciliation: AccStatementCheck.extend({ day: LocalDate, method: PaymentMethod, source: AccSource }),
});

export const AccStatementLine = z.object({ key: z.string(), label: z.string(), cents: SignedCents, entries: z.int().min(0) });
/** Mês civil AAAA-MM; o servidor recebe o primeiro dia (o período e o fuso vêm do banco). */
export const AccStatementInput = z
  .object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "AAAA-MM") })
  .transform((v) => ({ ...v, first_day: `${v.month}-01` }));
export const AccStatementOutput = z.object({
  basis: z.literal("cash"),
  period: z.object({ month: z.string(), starts_at: IsoDateTime, ends_at: IsoDateTime, first_day: LocalDate, last_day: LocalDate, timezone: TimeZone }),
  in_cents: SignedCents,
  out_cents: SignedCents,
  net_cents: SignedCents,
  income: z.array(AccStatementLine).max(200),
  expenses: z.array(AccStatementLine).max(200),
  coverage: z.object({
    uncharged_bookings: z.int().min(0),
    uncharged_cents: Cents,
    receivables_open_cents: SignedCents,
    payables_unpaid: z.int().min(0),
    payables_unpaid_cents: Cents,
    unclassified_entries: z.int().min(0),
    days_unreconciled: z.int().min(0),
    fiscal_authorized: z.int().min(0),
    fiscal_authorized_cents: Cents,
  }),
  as_of: IsoDateTime,
  note: z.string(),
});
export type AccStatement = z.infer<typeof AccStatementOutput>;

export const AccEntry = z.object({
  entry_kind: z.enum(["payment", "expense"]),
  entry_id: Uuid,
  at: IsoDateTime,
  amount_cents: Cents,
  description: z.string(),
  method: PaymentMethod.nullable(),
  source: AccSource.nullable(),
  /** Recebimento: origem (services, packages, other). Despesa: categoria do Caixa. */
  base: z.string(),
  category_id: Uuid.nullable(),
});
export type AccEntry = z.infer<typeof AccEntry>;
export const AccEntriesInput = AccStatementInput;
export const AccEntriesOutput = z.object({ entries: z.array(AccEntry).max(300) });
