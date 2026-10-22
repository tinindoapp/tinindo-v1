// Portas do módulo Pagamentos (P14). Demonstração: PSP fictício na aba, sempre rotulado; servidor: Edge Function `payments`.
import type {
  ChargeCreateOutput,
  ChargesListOutput,
  PaymentCharge,
  PaymentLinkView,
  PaymentProvider,
  PaymentRefund,
  Receivable,
  Reconciliation,
  SimPayOutput,
} from "@contracts";
import type { z } from "zod";

export type ChargesList = z.infer<typeof ChargesListOutput>;
export type ChargeCreated = z.infer<typeof ChargeCreateOutput>;
export type LinkView = z.infer<typeof PaymentLinkView>;
export type SimPayResult = z.infer<typeof SimPayOutput>;
export type { PaymentCharge, PaymentProvider, PaymentRefund, Receivable, Reconciliation };

/** Visão do dono. */
export interface PaymentsPort {
  readonly kind: "demo" | "server";
  /** Recebíveis em aberto do caixa (P07), candidatos a cobrança. */
  openReceivables(): Promise<Receivable[]>;
  charges(): Promise<ChargesList>;
  createCharge(receivableId: string, provider: PaymentProvider, key: string): Promise<ChargeCreated>;
  cancelCharge(charge: PaymentCharge, key: string): Promise<PaymentCharge>;
  refund(chargeId: string, reason: string, key: string): Promise<PaymentRefund>;
  reconcile(provider: PaymentProvider, day: string, key: string): Promise<Reconciliation>;
  reconciliations(): Promise<Reconciliation[]>;
  /** Só na demonstração: uma rodada do sync (no servidor, o cron faz isso). */
  sync?(): Promise<{ checked: number; settled: number; closed: number; still_unknown: number }>;
}

/** Visão do link público (cliente, sem login). */
export interface PaymentLinkPort {
  readonly kind: "demo" | "server";
  view(token: string): Promise<LinkView>;
  /** Só cobrança simulada: o cliente "paga"; notify=false simula o webhook perdido. */
  simPay(token: string, outcome: "paid" | "expired", notify: boolean): Promise<SimPayResult>;
}

export const newKey = () => crypto.randomUUID();
