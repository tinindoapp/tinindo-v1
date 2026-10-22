// Portas reais de Pagamentos: Edge Function `payments` (+ `finance` para os recebíveis em aberto).
import {
  ChargeCreateOutput,
  ChargeOutput,
  ChargesListOutput,
  FinanceLedgerOutput,
  PaymentLinkView,
  ReconcileOutput,
  ReconciliationsListOutput,
  RefundOutput,
  SimPayOutput,
} from "@contracts";
import type { createApiClient } from "../../lib/api/client.ts";
import type { PaymentLinkPort, PaymentsPort } from "./port.ts";

type Call = ReturnType<typeof createApiClient>;
const op = (name: string) => `/payments/${name}`;

export function createServerPort(call: Call, tenantId: string): PaymentsPort {
  const post = (body: unknown, idempotencyKey?: string) => ({ method: "POST" as const, tenantId, body, idempotencyKey });
  return {
    kind: "server",
    async openReceivables() {
      const now = Date.now();
      const period = { starts_at: new Date(now - 90 * 86_400_000).toISOString(), ends_at: new Date(now + 86_400_000).toISOString() };
      return (await call("/finance/finance.ledger", FinanceLedgerOutput, post({ period }))).data.receivables.filter((r) => r.status === "open" || r.status === "partially_paid");
    },
    async charges() {
      return (await call(op("payment.charges"), ChargesListOutput, post({}))).data;
    },
    async createCharge(receivable_id, provider, key) {
      return (await call(op("payment.charge_create"), ChargeCreateOutput, post({ receivable_id, provider }, key))).data;
    },
    async cancelCharge(c, key) {
      return (await call(op("payment.charge_cancel"), ChargeOutput, post({ charge_id: c.id, expected_version: c.version }, key))).data.charge;
    },
    async refund(charge_id, reason, key) {
      return (await call(op("payment.refund"), RefundOutput, post({ charge_id, reason }, key))).data.refund;
    },
    async reconcile(provider, day, key) {
      return (await call(op("payment.reconcile"), ReconcileOutput, post({ provider, day }, key))).data.reconciliation;
    },
    async reconciliations() {
      return (await call(op("payment.reconciliations"), ReconciliationsListOutput, post({}))).data.reconciliations;
    },
  };
}

/** Link anônimo: sem token de sessão; o token da cobrança vai no corpo do POST. */
export function createServerLinkPort(call: Call): PaymentLinkPort {
  return {
    kind: "server",
    async view(token) {
      return (await call(op("payment.link_view"), PaymentLinkView, { method: "POST", body: { token } })).data;
    },
    async simPay(token, outcome, notify) {
      return (await call(op("payment.sim_pay"), SimPayOutput, { method: "POST", body: { token, outcome, notify } })).data;
    },
  };
}
