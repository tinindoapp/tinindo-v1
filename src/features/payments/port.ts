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
  /** "demo" é a demonstração offline: só nela a simulação de pagamento aparece para quem abre o link (D22). */
  readonly kind: "demo" | "server";
  /** Nome do negócio para a mensagem de link não encontrado, quando conhecido sem o token (demonstração). */
  readonly businessName?: string;
  /** Relógio da demonstração (o prazo "de hoje" segue o relógio de exemplo). Sem isto, vale o relógio do aparelho. */
  now?(): Date;
  view(token: string): Promise<LinkView>;
  /** Só cobrança simulada: o cliente "paga"; notify=false simula o webhook perdido. */
  simPay(token: string, outcome: "paid" | "expired", notify: boolean): Promise<SimPayResult>;
}

