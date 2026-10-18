// Porta de dados do Caixa (P07). Duas implementações:
// - demoPort: emulação na aba sobre dados de exemplo (demonstração sem servidor), sempre rotulada;
// - serverPort: Edge Function `finance` (+ `crm` para nomes de clientes e serviços).
import type {
  ExpenseEntry,
  FinanceCancelReceivableInput,
  FinanceChargeBookingInput,
  FinanceCreateReceivableInput,
  FinanceLedgerOutput,
  FinanceRecordExpenseInput,
  FinanceRecordPaymentInput,
  FinanceReverseExpenseInput,
  FinanceReversePaymentInput,
  FinanceSummaryOutput,
  PackageBalance,
  PackageConsumeInput,
  PackageDetail,
  PackageReverseInput,
  PackageSellInput,
  PaymentEntry,
  ProviderService,
  Receivable,
  TimeRange,
  UnchargedBooking,
} from "@contracts";
import type { z } from "zod";

export interface FinanceBase {
  timezone: string;
  customers: { id: string; name: string }[];
  services: ProviderService[];
}

export type In<T extends z.ZodType> = z.input<T>;

export interface FinancePort {
  readonly kind: "demo" | "server";
  now(): Date;
  base(): Promise<FinanceBase>;
  summary(period: TimeRange, timezone: string): Promise<z.infer<typeof FinanceSummaryOutput>>;
  ledger(period: TimeRange): Promise<z.infer<typeof FinanceLedgerOutput>>;
  uncharged(period: TimeRange): Promise<UnchargedBooking[]>;
  packages(): Promise<PackageDetail[]>;
  createReceivable(input: In<typeof FinanceCreateReceivableInput>, key: string): Promise<Receivable>;
  chargeBooking(input: In<typeof FinanceChargeBookingInput>, key: string): Promise<Receivable>;
  cancelReceivable(input: In<typeof FinanceCancelReceivableInput>, key: string): Promise<Receivable>;
  recordPayment(input: In<typeof FinanceRecordPaymentInput>, key: string): Promise<z.infer<typeof PaymentEntry>>;
  reversePayment(input: In<typeof FinanceReversePaymentInput>, key: string): Promise<void>;
  recordExpense(input: In<typeof FinanceRecordExpenseInput>, key: string): Promise<ExpenseEntry>;
  reverseExpense(input: In<typeof FinanceReverseExpenseInput>, key: string): Promise<void>;
  sellPackage(input: In<typeof PackageSellInput>, key: string): Promise<void>;
  consumePackage(input: In<typeof PackageConsumeInput>, key: string): Promise<z.infer<typeof PackageBalance>>;
  reversePackage(input: In<typeof PackageReverseInput>, key: string): Promise<void>;
}

export function newKey(): string {
  return crypto.randomUUID();
}
