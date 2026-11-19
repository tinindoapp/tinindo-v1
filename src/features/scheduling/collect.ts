// Porta da Agenda para cobrar o atendimento que acabou de concluir (P48). A Agenda não importa o módulo do Caixa: fala
// com a função `finance` pelo contrato v1, com o próprio cliente de API. Na demonstração, usa o caixa emulado da aba
// (src/lib/demo/journey.ts), o mesmo que a tela do Caixa lê. Concluir continua sendo outra operação (`booking.complete`).
import {
  FinanceUnchargedOutput,
  PackageBalance,
  PackageListOutput,
  PaymentEntry,
  ReceivableOutput,
} from "@contracts";
import type { createApiClient } from "../../lib/api/client.ts";
import type { BookingCollectPort } from "../../lib/collect.ts";

type Call = ReturnType<typeof createApiClient>;

export function createServerCollectPort(call: Call, tenantId: string): BookingCollectPort {
  const post = (body: unknown, idempotencyKey?: string) => ({ method: "POST" as const, tenantId, body, idempotencyKey });
  const fin = (op: string) => `/finance/${op}`;
  return {
    now: () => new Date(),
    async uncharged(period) {
      return (await call(fin("finance.uncharged"), FinanceUnchargedOutput, post({ period }))).data.bookings;
    },
    async packages() {
      return (await call(fin("package.list"), PackageListOutput, post({}))).data.packages;
    },
    async chargeBooking(input, key) {
      return (await call(fin("finance.charge_booking"), ReceivableOutput, post(input, key))).data.receivable;
    },
    async recordPayment(input, key) {
      return (await call(fin("finance.record_payment"), PaymentEntry, post(input, key))).data;
    },
    async consumePackage(input, key) {
      return (await call(fin("package.consume"), PackageBalance, post(input, key))).data;
    },
  };
}
