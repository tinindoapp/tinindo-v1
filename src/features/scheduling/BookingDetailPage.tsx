// Atendimento: detalhe, cancelar (com motivo e política) e concluir. Reagendar abre o fluxo.
import { useState } from "react";
import { Link, useLocation, useParams } from "react-router";
import type { Booking } from "@contracts";
import { Button, StatusBanner } from "../../components/ui/index.tsx";
import { newIdempotencyKey } from "./port.ts";
import { canCancel, canComplete, canReschedule, formatCents, formatRange, serviceName } from "./agenda.ts";
import { formatDayLong, localParts } from "./time.ts";
import { DemoNotice, ErrorPanel, PolicyNote, StatusBadge, TimezoneNote } from "./parts.tsx";
import { useAsync, useBase, usePort } from "./SchedulingLayout.tsx";

const SOURCE_LABEL: Record<Booking["source"], string> = {
  owner: "Criado por você",
  public_link: "Link de agendamento",
  waitlist: "Lista de espera",
  agent: "Assistente",
  import: "Importação",
  quote: "Orçamento aceito",
};

const DONE_MESSAGE: Record<string, string> = {
  criado: "Agendamento confirmado.",
  reagendado: "Atendimento reagendado.",
};

export function BookingDetailPage() {
  const { bookingId = "" } = useParams();
  const port = usePort();
  const { ctx } = useBase();
  const state = useAsync(`booking:${bookingId}`, () => port.getBooking(bookingId));
  const location = useLocation();
  const done = (location.state as { done?: string } | null)?.done;
  // Ficam fora do detalhe: o detalhe é remontado a cada versão nova do atendimento.
  const [message, setMessage] = useState<string | undefined>(done ? DONE_MESSAGE[done] : undefined);
  const [failure, setFailure] = useState<Failure | null>(null);

  return (
    <section aria-labelledby="booking-title" className="tn-sched">
      <Link
        to={`../..${state.data ? `?data=${localParts(state.data.starts_at, ctx.timezone).date}` : ""}`}
        relative="path"
        className="tn-sched-back"
      >
        ‹ Voltar para a agenda
      </Link>
      <h1 id="booking-title">Atendimento</h1>
      <DemoNotice kind={port.kind} />
      {state.error ? (
        <ErrorPanel error={state.error} operation="load" onRetry={state.reload} />
      ) : !state.data ? (
        <p role="status" className="tn-sched-loading">
          Carregando atendimento…
        </p>
      ) : (
        <>
          {message ? <StatusBanner tone="success">{message}</StatusBanner> : null}
          {failure ? <ErrorPanel error={failure.err} operation={failure.op} /> : null}
          <BookingDetail
            key={state.data.version}
            booking={state.data}
            reload={state.reload}
            onMessage={(m) => {
              setFailure(null);
              setMessage(m);
            }}
            onFailure={(f) => {
              setMessage(undefined);
              setFailure(f);
            }}
          />
        </>
      )}
    </section>
  );
}

type Panel = null | "cancel" | "complete";
type Failure = { err: unknown; op: "cancel" | "complete" };

function BookingDetail({
  booking,
  reload,
  onMessage,
  onFailure,
}: {
  booking: Booking;
  reload: () => void;
  onMessage: (m: string) => void;
  onFailure: (f: Failure | null) => void;
}) {
  const port = usePort();
  const { ctx, services, customers } = useBase();
  const tz = ctx.timezone;
  const [panel, setPanel] = useState<Panel>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | undefined>();
  const [pending, setPending] = useState(false);
  // Mesma chave enquanto o pedido não mudar: tentar de novo não duplica (ADR-0002).
  const [keys] = useState(() => ({ cancel: newIdempotencyKey(), complete: newIdempotencyKey() }));

  const customer = customers.find((c) => c.id === booking.customer_id)?.name ?? (booking.customer_id ? "Cliente" : "Sem cliente cadastrado");
  const date = localParts(booking.starts_at, tz).date;

  async function submit(op: "cancel" | "complete") {
    if (op === "cancel" && !reason.trim()) {
      setReasonError("Informe o motivo do cancelamento.");
      return;
    }
    setPending(true);
    onFailure(null);
    try {
      if (op === "cancel") {
        await port.cancel({ booking_id: booking.id, expected_version: booking.version, reason: reason.trim() }, keys.cancel);
        onMessage("Atendimento cancelado. O horário voltou a ficar livre.");
      } else {
        await port.complete({ booking_id: booking.id, expected_version: booking.version }, keys.complete);
        onMessage("Atendimento concluído. O pagamento não foi registrado: registre em Dinheiro quando receber.");
      }
      setPanel(null);
      reload();
    } catch (err) {
      onFailure({ err, op });
      const code = (err as { code?: string }).code;
      if (code === "STALE_VERSION" || code === "IDEMPOTENCY_MISMATCH") {
        // Dados desatualizados: recarrega para mostrar o estado atual antes de nova tentativa.
        setPanel(null);
        reload();
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="tn-sched-detail">
      <div className="tn-sched-detail__head">
        <h2>{serviceName(services, booking.service_id)}</h2>
        <StatusBadge status={booking.status} />
      </div>
      <dl className="tn-sched-dl">
        <dt>Quando</dt>
        <dd className="tn-num">
          {formatDayLong(date)}, {formatRange(booking, tz)}
        </dd>
        <dt>Cliente</dt>
        <dd>{customer}</dd>
        <dt>Preço combinado</dt>
        <dd className="tn-num">{booking.agreed_price_cents === null ? "A definir" : formatCents(booking.agreed_price_cents)}</dd>
        {booking.status === "held" && booking.hold_expires_at ? (
          <>
            <dt>Reserva provisória</dt>
            <dd className="tn-num">Vence às {localParts(booking.hold_expires_at, tz).time} se não for confirmada</dd>
          </>
        ) : null}
        <dt>Origem</dt>
        <dd>{SOURCE_LABEL[booking.source]}</dd>
      </dl>
      <TimezoneNote timezone={tz} at={booking.starts_at} />

      {panel === null ? (
        <div className="tn-sched-actions">
          {canReschedule(booking) ? (
            <Link className="tn-button" data-variant="secondary" to="reagendar">
              Reagendar
            </Link>
          ) : null}
          {canComplete(booking, port.now()) ? (
            <Button variant="secondary" onClick={() => setPanel("complete")}>
              Concluir atendimento
            </Button>
          ) : null}
          {canCancel(booking) ? (
            <Button variant="ghost" onClick={() => setPanel("cancel")}>
              Cancelar atendimento
            </Button>
          ) : null}
        </div>
      ) : null}

      {panel === "cancel" ? (
        <form
          className="tn-sched-confirm"
          aria-labelledby="cancel-title"
          onSubmit={(e) => {
            e.preventDefault();
            void submit("cancel");
          }}
        >
          <h3 id="cancel-title">Cancelar este atendimento?</h3>
          <p>
            O horário {formatRange(booking, tz)} fica livre para outro cliente. Nenhuma mensagem é enviada
            automaticamente ao cliente.
          </p>
          <PolicyNote demo={port.kind === "fixture"} />
          <div className="tn-field">
            <label htmlFor="cancel-reason">Motivo</label>
            <textarea
              id="cancel-reason"
              value={reason}
              maxLength={280}
              rows={3}
              aria-invalid={reasonError ? true : undefined}
              aria-describedby={reasonError ? "cancel-reason-error" : undefined}
              onChange={(e) => {
                setReason(e.target.value);
                setReasonError(undefined);
              }}
            />
            {reasonError ? (
              <span id="cancel-reason-error" role="alert">
                {reasonError}
              </span>
            ) : null}
          </div>
          <div className="tn-sched-actions">
            <Button type="submit" disabled={pending} aria-busy={pending || undefined}>
              {pending ? "Cancelando…" : "Confirmar cancelamento"}
            </Button>
            <Button variant="ghost" onClick={() => setPanel(null)} disabled={pending}>
              Voltar
            </Button>
          </div>
        </form>
      ) : null}

      {panel === "complete" ? (
        <div className="tn-sched-confirm" role="group" aria-labelledby="complete-title">
          <h3 id="complete-title">Marcar como concluído?</h3>
          <p>Isso registra que o atendimento aconteceu. Não registra pagamento.</p>
          <div className="tn-sched-actions">
            <Button onClick={() => void submit("complete")} disabled={pending} aria-busy={pending || undefined}>
              {pending ? "Concluindo…" : "Confirmar conclusão"}
            </Button>
            <Button variant="ghost" onClick={() => setPanel(null)} disabled={pending}>
              Voltar
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
