// "Atendido" e "Faltou" depois do início do horário (auditoria de UX, item 25). O mesmo par aparece no detalhe do
// atendimento, no cartão da linha do dia e no cartão "Próximo" da Hoje.
// - Atendido (P48): no lugar da confirmação, as três saídas do Caixa: "Recebi R$ 60,00 no Pix ▾", "Cobrar depois" e
//   "Usar crédito do pacote", quando houver. Um toque conclui e registra. No servidor continuam sendo operações
//   separadas: concluir (`booking.complete`) e depois cobrar + receber (`finance`), cada uma com a sua chave. Sem acesso
//   ao Caixa (ou sem preço nem pacote), volta à confirmação "Sim, foi atendido", que só conclui.
// - Faltou volta atrás (`booking.no_show` com `revert`): executa na hora e o aviso oferece Desfazer.
import { useEffect, useId, useRef, useState } from "react";
import { useNavigate } from "react-router";
import type { Booking, PackageDetail } from "@contracts";
import { Button, toast } from "../../components/ui/index.tsx";
import { CollectActions } from "../../components/ui/collect.tsx";
import { type BookingCollectPort, creditPackages, explainFinanceError, findUncharged, METHOD_PHRASE, type Method, useCollectBooking } from "../../lib/collect.ts";
import { useIdempotencyKey } from "../../lib/idempotency.ts";
import { formatCents } from "../../lib/money.ts";
import { FIXED_REASON } from "./agenda.ts";
import { explainError, isErrorLike, type Operation } from "./errors.ts";
import { newIdempotencyKey } from "./port.ts";
import { useCollectPort, usePort } from "./SchedulingLayout.tsx";

/** Erro de ação de um toque vira aviso curto; dado desatualizado recarrega a tela. */
export function toastFailure(err: unknown, op: Operation, reload: () => void) {
  const e = explainError(err, op);
  toast({ tone: "danger", message: `${e.title}. ${e.body}` });
  if (isErrorLike(err) && (err.code === "STALE_VERSION" || err.code === "IDEMPOTENCY_MISMATCH")) reload();
}

/** Porta vazia para quando não há Caixa: o hook de cobrança é chamado sempre, mas nada o usa. */
const NO_COLLECT: BookingCollectPort = {
  now: () => new Date(),
  uncharged: () => Promise.reject(new Error("sem caixa")),
  packages: () => Promise.reject(new Error("sem caixa")),
  chargeBooking: () => Promise.reject(new Error("sem caixa")),
  recordPayment: () => Promise.reject(new Error("sem caixa")),
  consumePackage: () => Promise.reject(new Error("sem caixa")),
};

/** "Caixa" com link para o próprio atendimento: o Caixa rola até ele e abre a ação. */
export function cashierHref(bookingId: string): string {
  return `/app/caixa?atendimento=${bookingId}`;
}

export function AttendanceActions({
  booking,
  when,
  onChanged,
}: {
  booking: Booking;
  /** Complemento do nome acessível quando há vários na tela ("às 09:00"). Vazio no detalhe. */
  when?: string;
  onChanged: () => void;
}) {
  const port = usePort();
  const cashier = useCollectPort();
  const navigate = useNavigate();
  const [choosing, setChoosing] = useState(false);
  const [credits, setCredits] = useState<PackageDetail[] | null>(null);
  // Qual ação está rodando: "complete", "no_show", "paid", "later" ou o id do pacote.
  const [pending, setPending] = useState<string | null>(null);
  // Mesma chave enquanto o pedido não mudar: repetir não duplica (ADR-0002). Trocar de saída depois de uma falha
  // reaproveita a conclusão já feita.
  const completeKey = useIdempotencyKey();
  const noShowKey = useIdempotencyKey();
  const collect = useCollectBooking(cashier ?? NO_COLLECT, booking.id);
  const titleId = useId();
  const title = useRef<HTMLParagraphElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  // Toque duplo antes do próximo render: o segundo é ignorado (o botão só fica desligado depois do render).
  const running = useRef(false);
  // Nome acessível com o horário quando há vários na tela; começa pelo texto visível (WCAG 2.5.3).
  const named = (label: string) => (when ? `${label} ${when}` : undefined);

  useEffect(() => {
    if (choosing) title.current?.focus();
    else if (returnFocus.current) {
      returnFocus.current = false;
      trigger.current?.focus();
    }
  }, [choosing]);

  // Pacotes do cliente para este serviço, lidos ao abrir as saídas (o servidor confere de novo ao debitar).
  useEffect(() => {
    if (!choosing || !cashier) return;
    let alive = true;
    cashier.packages().then(
      (list) => alive && setCredits(creditPackages(list, booking)),
      () => alive && setCredits([]),
    );
    return () => {
      alive = false;
    };
  }, [choosing, cashier, booking]);

  const completeBody = { booking_id: booking.id, expected_version: booking.version };
  const completeOnce = () => port.complete(completeBody, completeKey.keyFor(completeBody));

  /** Só concluir (sem Caixa ou sem como cobrar aqui): o atendimento fica "sem cobrança" no Caixa. */
  async function completeOnly() {
    setPending("complete");
    try {
      await completeOnce();
      toast({
        message: "Atendimento concluído. O pagamento não foi registrado: cobre e registre o recebimento no Caixa quando receber.",
        duration: 8000,
      });
      onChanged();
    } catch (err) {
      toastFailure(err, "complete", onChanged);
    } finally {
      setPending(null);
    }
  }

  /** Um toque: conclui e registra. Se a conclusão passou e o Caixa falhou, diz isso e leva ao atendimento no Caixa. */
  async function finish(which: string, record: () => Promise<string>) {
    if (running.current) return;
    running.current = true;
    setPending(which);
    let completed = false;
    try {
      await completeOnce();
      completed = true;
      toast({ message: await record(), duration: 8000 });
    } catch (err) {
      if (!completed) toastFailure(err, "complete", onChanged);
      else {
        toast({
          tone: "danger",
          message: `Atendimento concluído, mas o Caixa não registrou: ${explainFinanceError(err)} Cobre pelo Caixa.`,
          action: { label: "Abrir no Caixa", onAction: () => void navigate(cashierHref(booking.id)) },
          duration: 10000,
        });
      }
    } finally {
      running.current = false;
      setPending(null);
      if (completed) onChanged();
    }
  }

  const receive = (method: Method) =>
    finish("paid", async () => {
      const r = await collect.receive(method);
      return `Atendimento concluído e ${formatCents(r.amount_cents)} recebido ${METHOD_PHRASE[method]}${when ? ` ${when}` : ""}. Registro manual no Caixa.`;
    });
  const later = () =>
    finish("later", async () => {
      const r = await collect.later();
      return `Atendimento concluído. Cobrança de ${formatCents(r.amount_cents)} em "A receber" no Caixa até você registrar o recebimento.`;
    });
  const credit = (packageId: string) =>
    finish(packageId, async () => {
      // O débito é único por evento de conclusão: o Caixa informa qual é depois de concluir.
      const visit = await findUncharged(cashier!, booking);
      const bal = await collect.consumeCredit(packageId, visit?.completed_event_id ?? null);
      return `Atendimento concluído com crédito do pacote. Saldo: ${bal.remaining_credits} ${bal.remaining_credits === 1 ? "sessão" : "sessões"}. Nenhum valor novo entra no caixa.`;
    });

  async function noShow() {
    setPending("no_show");
    try {
      const body = { booking_id: booking.id, expected_version: booking.version, reason: FIXED_REASON.noShow };
      const marked = await port.noShow(body, noShowKey.keyFor(body));
      toast({
        message: `Falta registrada${when ? ` ${when}` : ""}. O horário deixou de contar como atendimento.`,
        action: {
          label: "Desfazer",
          onAction: async () => {
            try {
              // Desfazer é outro pedido (revert): chave própria, sem reaproveitar a da falta.
              await port.noShow(
                { booking_id: marked.id, expected_version: marked.version, reason: FIXED_REASON.noShowRevert, revert: true },
                newIdempotencyKey(),
              );
              toast("Falta desfeita. O atendimento voltou a ficar confirmado.");
            } catch (err) {
              toastFailure(err, "no_show", onChanged);
            } finally {
              onChanged();
            }
          },
        },
      });
      onChanged();
    } catch (err) {
      toastFailure(err, "no_show", onChanged);
    } finally {
      setPending(null);
    }
  }

  if (choosing) {
    // Com Caixa: as saídas aparecem já com o preço; o crédito do pacote entra quando a leitura chega.
    const canCollect = !!cashier && (booking.agreed_price_cents !== null || (credits?.length ?? 0) > 0);
    const waitingCredits = !!cashier && booking.agreed_price_cents === null && credits === null;
    return (
      <div className="tn-confirm tn-sched-attend" role="group" aria-labelledby={titleId}>
        <p id={titleId} ref={title} tabIndex={-1} className="tn-confirm__title">
          {canCollect || waitingCredits ? `Atendido${when ? ` ${when}` : ""}. Como fica o pagamento?` : `Marcar como atendido${when ? ` ${when}` : ""}?`}
        </p>
        {canCollect ? (
          <>
            <p className="tn-confirm__body">Um toque conclui o atendimento e registra no Caixa.</p>
            <CollectActions idBase={`att-${booking.id}`} label={when ?? ""} amountCents={booking.agreed_price_cents} credits={credits ?? []}
              pending={pending} onReceive={(m) => void receive(m)} onLater={() => void later()} onCredit={(id) => void credit(id)} />
          </>
        ) : waitingCredits ? (
          <p role="status" className="tn-confirm__body">Conferindo os pacotes do cliente…</p>
        ) : (
          <p className="tn-confirm__body">Isso registra que o atendimento aconteceu. Não registra pagamento.</p>
        )}
        <div className="tn-actions">
          {!canCollect && !waitingCredits ? (
            <Button onClick={() => void completeOnly()} loading={pending === "complete"} loadingText="Salvando…">
              Sim, foi atendido
            </Button>
          ) : null}
          <Button
            variant="ghost"
            disabled={pending !== null}
            onClick={() => {
              returnFocus.current = true;
              setChoosing(false);
            }}
          >
            Voltar
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="tn-actions tn-sched-attend">
      <Button ref={trigger} variant="secondary" aria-label={named("Atendido")} onClick={() => setChoosing(true)} disabled={pending !== null}>
        Atendido
      </Button>
      <Button variant="ghost" aria-label={named("Faltou")} onClick={() => void noShow()} loading={pending === "no_show"} loadingText="Salvando…">
        Faltou
      </Button>
    </div>
  );
}
