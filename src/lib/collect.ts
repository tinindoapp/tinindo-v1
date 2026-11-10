// Cobrar um atendimento concluído: a parte comum ao atalho do Caixa e às saídas de "Atendido" na Agenda e na Hoje
// (revisão de 10/11, P48). Não conhece módulo: recebe uma porta com as operações do contrato `finance` (cada módulo
// traz a sua, ligada ao próprio cliente de API ou à demonstração) e devolve as três saídas.
// Regra que não muda: concluir ≠ cobrar ≠ receber. "Recebi" é cobrança + pagamento, dois registros no servidor; se o
// segundo falhar, a cobrança fica em "A receber" e visível. Crédito de pacote debita sessão e não entra no caixa.
import { useCallback } from "react";
import type {
  FinanceChargeBookingInput,
  FinanceRecordPaymentInput,
  PackageBalance,
  PackageConsumeInput,
  PackageDetail,
  PaymentEntry,
  PaymentMethod,
  Receivable,
  TimeRange,
  UnchargedBooking,
} from "@contracts";
import type { z } from "zod";
import { useAttemptValue, useIdempotencyKey } from "./idempotency.ts";

export type Method = z.infer<typeof PaymentMethod>;

/** Operações do contrato `finance` que cobrar um atendimento usa. A porta do Caixa já tem esta forma. */
export interface BookingCollectPort {
  now(): Date;
  uncharged(period: TimeRange): Promise<UnchargedBooking[]>;
  packages(): Promise<PackageDetail[]>;
  chargeBooking(input: z.input<typeof FinanceChargeBookingInput>, key: string): Promise<Receivable>;
  recordPayment(input: z.input<typeof FinanceRecordPaymentInput>, key: string): Promise<z.infer<typeof PaymentEntry>>;
  consumePackage(input: z.input<typeof PackageConsumeInput>, key: string): Promise<z.infer<typeof PackageBalance>>;
}

export const METHOD_LABEL: Record<Method, string> = { pix: "Pix", cash: "Dinheiro", card: "Cartão", transfer: "Transferência", other: "Outro" };
/** Como a forma entra na frase do atalho: "Recebi R$ 60,00 no Pix". */
export const METHOD_PHRASE: Record<Method, string> = { pix: "no Pix", cash: "em dinheiro", card: "no cartão", transfer: "por transferência", other: "de outra forma" };
export const METHODS = Object.keys(METHOD_LABEL) as Method[];

/** Pacotes que podem pagar o atendimento: mesmo cliente e serviço, com saldo e válidos no dia (a regra do servidor). */
export function creditPackages(
  packages: PackageDetail[],
  booking: { customer_id: string | null; service_id: string; starts_at: string },
): PackageDetail[] {
  if (!booking.customer_id) return [];
  return packages.filter((p) => p.customer_id === booking.customer_id && p.service_id === booking.service_id && p.remaining_credits > 0
    && (!p.expires_at || Date.parse(p.expires_at) >= Date.parse(booking.starts_at)));
}

/** O atendimento concluído como o Caixa o vê (com o evento de conclusão que autoriza o débito de crédito). */
export async function findUncharged(port: BookingCollectPort, booking: { id: string; starts_at: string; ends_at: string }) {
  const list = await port.uncharged({ starts_at: booking.starts_at, ends_at: booking.ends_at });
  return list.find((b) => b.booking_id === booking.id) ?? null;
}

/**
 * As três saídas de um atendimento concluído, com chave por pedido (ADR-0002): repetir depois de falha manda a mesma
 * chave e o mesmo corpo, então não duplica a cobrança nem o recebimento. O instante do recebimento também é fixado na
 * primeira tentativa (vai no corpo; outro instante mudaria a chave).
 */
export function useCollectBooking(port: BookingCollectPort, bookingId: string) {
  const charge = useIdempotencyKey();
  const pay = useIdempotencyKey();
  const credit = useIdempotencyKey();
  const instant = useAttemptValue<string>();
  const chargeOnce = useCallback(
    () => port.chargeBooking({ booking_id: bookingId }, charge.keyFor({ charge: bookingId })),
    [port, bookingId, charge],
  );

  /** Cobra e registra o recebimento do valor cobrado (o calculado pelo servidor; não há valor editável aqui). */
  const receive = useCallback(async (method: Method) => {
    const r = await chargeOnce();
    const received_at = instant.valueFor({ bookingId, method }, () => port.now().toISOString());
    const payment = { receivable_id: r.id, amount_cents: r.amount_cents, method, received_at };
    await port.recordPayment(payment, pay.keyFor(payment));
    return r;
  }, [port, bookingId, chargeOnce, instant, pay]);

  /** Só a cobrança: fica em "A receber" até registrar o recebimento. */
  const later = useCallback(() => chargeOnce(), [chargeOnce]);

  /** Debita uma sessão do pacote, uma vez por evento de conclusão. Nenhum valor entra no caixa. */
  const consumeCredit = useCallback(async (packageId: string, eventId: string | null) => {
    if (!eventId) throw { code: "POLICY_REJECTED", field: "event_id" };
    return port.consumePackage({ package_id: packageId, booking_id: bookingId, event_id: eventId }, credit.keyFor({ consume: bookingId, packageId }));
  }, [port, bookingId, credit]);

  return { receive, later, consumeCredit };
}

/** Explica erros do contrato `finance` sem jargão; diz o que NÃO aconteceu. */
export function explainFinanceError(err: unknown): string {
  const e = err as { code?: string; field?: string } | null;
  switch (e?.code) {
    case "POLICY_REJECTED":
      if (e.field === "amount_cents") return "O valor é maior que o que falta receber. Nada foi registrado.";
      if (e.field === "remaining_credits") return "O pacote não tem mais créditos. Nada foi debitado.";
      if (e.field === "package") return "Este atendimento já foi pago com crédito de pacote; cobrar de novo duplicaria a receita.";
      if (e.field === "booking_id") return "Este atendimento já tem cobrança ou crédito usado. Nada foi alterado.";
      if (e.field === "reversal_of" || e.field === "entry_id") return "Isso já foi estornado. Nada foi alterado.";
      return "As regras não permitem esta ação agora. Nada foi alterado.";
    case "VALIDATION_ERROR":
      return e.field === "received_at" || e.field === "paid_at"
        ? "A data não pode ser no futuro. Nada foi registrado."
        : "Confira os dados. Nada foi registrado.";
    case "STALE_VERSION":
      return "Este registro mudou em outro lugar. Atualizamos a lista: revise e tente de novo.";
    case "IDEMPOTENCY_MISMATCH":
      return "Pedido repetido com dados diferentes. Nada novo foi gravado.";
    case "FORBIDDEN":
      return "Só o dono do negócio acessa o caixa.";
    case "PROVIDER_UNAVAILABLE":
    case "INTERNAL_ERROR":
      return "Sem resposta do servidor. Tentar de novo é seguro: o pedido usa a mesma chave e não duplica.";
    default:
      return "Não foi possível concluir. Nada foi alterado por esta tentativa.";
  }
}
