// "Atendido" e "Faltou" depois do início do horário (auditoria de UX, item 25). O mesmo par aparece no detalhe do
// atendimento e no cartão da linha do dia.
// - Atendido não volta atrás (o atendimento passa para o Caixa como sem cobrança): pede confirmação, sem cor de perigo.
// - Faltou volta atrás (`booking.no_show` com `revert`): executa na hora e o aviso oferece Desfazer.
import { useEffect, useId, useRef, useState } from "react";
import type { Booking } from "@contracts";
import { Button, toast } from "../../components/ui/index.tsx";
import { FIXED_REASON } from "./agenda.ts";
import { explainError, isErrorLike, type Operation } from "./errors.ts";
import { newIdempotencyKey } from "./port.ts";
import { usePort } from "./SchedulingLayout.tsx";

/** Erro de ação de um toque vira aviso curto; dado desatualizado recarrega a tela. */
export function toastFailure(err: unknown, op: Operation, reload: () => void) {
  const e = explainError(err, op);
  toast({ tone: "danger", message: `${e.title}. ${e.body}` });
  if (isErrorLike(err) && (err.code === "STALE_VERSION" || err.code === "IDEMPOTENCY_MISMATCH")) reload();
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
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState<null | "complete" | "no_show">(null);
  // Mesma chave enquanto o pedido não mudar: repetir não duplica (ADR-0002).
  const [keys] = useState(() => ({ complete: newIdempotencyKey(), noShow: newIdempotencyKey() }));
  const titleId = useId();
  const title = useRef<HTMLParagraphElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  // Nome acessível com o horário quando há vários na tela; começa pelo texto visível (WCAG 2.5.3).
  const named = (label: string) => (when ? `${label} ${when}` : undefined);

  useEffect(() => {
    if (confirming) title.current?.focus();
    else if (returnFocus.current) {
      returnFocus.current = false;
      trigger.current?.focus();
    }
  }, [confirming]);

  async function complete() {
    setPending("complete");
    try {
      await port.complete({ booking_id: booking.id, expected_version: booking.version }, keys.complete);
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

  async function noShow() {
    setPending("no_show");
    try {
      const marked = await port.noShow(
        { booking_id: booking.id, expected_version: booking.version, reason: FIXED_REASON.noShow },
        keys.noShow,
      );
      toast({
        message: `Falta registrada${when ? ` ${when}` : ""}. O horário deixou de contar como atendimento.`,
        action: {
          label: "Desfazer",
          onAction: async () => {
            try {
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

  if (confirming) {
    return (
      <div className="tn-confirm tn-sched-attend" role="group" aria-labelledby={titleId}>
        <p id={titleId} ref={title} tabIndex={-1} className="tn-confirm__title">
          Marcar como atendido{when ? ` ${when}` : ""}?
        </p>
        <p className="tn-confirm__body">Isso registra que o atendimento aconteceu. Não registra pagamento.</p>
        <div className="tn-actions">
          <Button onClick={() => void complete()} loading={pending === "complete"} loadingText="Salvando…">
            Sim, foi atendido
          </Button>
          <Button
            variant="ghost"
            disabled={pending !== null}
            onClick={() => {
              returnFocus.current = true;
              setConfirming(false);
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
      <Button ref={trigger} variant="secondary" aria-label={named("Atendido")} onClick={() => setConfirming(true)} disabled={pending !== null}>
        Atendido
      </Button>
      <Button variant="ghost" aria-label={named("Faltou")} onClick={() => void noShow()} loading={pending === "no_show"} loadingText="Salvando…">
        Faltou
      </Button>
    </div>
  );
}
