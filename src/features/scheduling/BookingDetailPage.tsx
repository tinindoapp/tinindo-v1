// Atendimento: detalhe e o que fazer com ele.
// - Reserva provisória: confirmar, liberar o horário e o prazo (item 24 da auditoria de UX).
// - Depois do início: "Atendido" e "Faltou" (item 25).
// - Cancelar pede motivo; depois do cancelamento, o próximo passo fica na tela: desfazer, avisar e lista de espera (item 27).
// Reagendar abre o fluxo.
import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import type { Booking } from "@contracts";
import { Button, ConfirmAction, Field, PageHeader, toast } from "../../components/ui/index.tsx";
import { newIdempotencyKey, type PublicBookingContact } from "./port.ts";
import {
  canCancel,
  canComplete,
  canConfirmHold,
  canMarkNoShow,
  canReschedule,
  cancelNoticeText,
  FIXED_REASON,
  formatCents,
  formatRange,
  serviceName,
  waitlistMatches,
  whatsAppDigits,
} from "./agenda.ts";
import { AttendanceActions, toastFailure } from "./attendance.tsx";
import type { Operation } from "./errors.ts";
import { formatDayLong, localParts } from "./time.ts";
import { DemoNotice, ErrorPanel, PolicyNote, StatusBadge, TimezoneNote } from "./parts.tsx";
import { useAsync, useBase, usePort } from "./SchedulingLayout.tsx";

const DONE_MESSAGE: Record<string, string> = {
  criado: "Agendamento confirmado.",
  reagendado: "Atendimento reagendado.",
};

const SOURCE_LABEL: Record<Booking["source"], string> = {
  owner: "Criado por você",
  public_link: "Link de agendamento",
  waitlist: "Lista de espera",
  agent: "Assistente",
  import: "Importação",
  quote: "Orçamento aceito",
};

type Failure = { err: unknown; op: Operation };

/** O que a tela guarda do cancelamento feito agora (contato e próximo passo). Depois de recarregar, o motivo vem de `status_reason`. */
interface Cancelled {
  booking: Booking;
  reason: string;
  /** Nome e WhatsApp de quem pediu pelo link, ou do cadastro do cliente. */
  contactName: string | null;
  phone: string | null;
}

export function BookingDetailPage() {
  const { bookingId = "" } = useParams();
  const port = usePort();
  const { ctx } = useBase();
  const state = useAsync(`booking:${bookingId}`, () => port.getBooking(bookingId));
  // Confirmação de quem chegou do fluxo de novo/reagendar: Toast quando o atendimento aparece, uma vez por navegação.
  const location = useLocation();
  const done = (location.state as { done?: string } | null)?.done;
  const loaded = state.data !== undefined;
  const toasted = useRef<string | null>(null);
  useEffect(() => {
    if (!loaded || !done || !DONE_MESSAGE[done] || toasted.current === location.key) return;
    toasted.current = location.key;
    toast(DONE_MESSAGE[done]);
  }, [loaded, done, location.key]);
  // Ficam fora do detalhe: o detalhe é remontado a cada versão nova do atendimento.
  const [failure, setFailure] = useState<Failure | null>(null);
  const [cancelled, setCancelled] = useState<Cancelled | null>(null);
  // Próximo passo enquanto a pessoa está neste atendimento e ele continua cancelado.
  const nextStep = cancelled && cancelled.booking.id === bookingId && state.data?.status === "cancelled" ? cancelled : null;

  return (
    <section aria-labelledby="booking-title" className="tn-sched">
      <Link
        to={`../..${state.data ? `?data=${localParts(state.data.starts_at, ctx.timezone).date}` : ""}`}
        relative="path"
        className="tn-sched-back"
      >
        ‹ Voltar para a agenda
      </Link>
      <PageHeader id="booking-title" title="Atendimento" />
      <DemoNotice kind={port.kind} />
      {state.error ? (
        <ErrorPanel error={state.error} operation="load" onRetry={state.reload} />
      ) : !state.data ? (
        <p role="status" className="tn-sched-loading">
          Carregando atendimento…
        </p>
      ) : (
        <>
          {failure ? <ErrorPanel error={failure.err} operation={failure.op} /> : null}
          {nextStep ? <AfterCancel info={nextStep} /> : null}
          <BookingDetail
            key={state.data.version}
            booking={state.data}
            reload={state.reload}
            onFailure={setFailure}
            onCancelled={setCancelled}
          />
        </>
      )}
    </section>
  );
}

function BookingDetail({
  booking,
  reload,
  onFailure,
  onCancelled,
}: {
  booking: Booking;
  reload: () => void;
  onFailure: (f: Failure | null) => void;
  onCancelled: (c: Cancelled) => void;
}) {
  const port = usePort();
  const { ctx, services, customers } = useBase();
  const tz = ctx.timezone;
  const now = port.now();
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | undefined>();
  const [confirming, setConfirming] = useState(false);
  // Mesma chave enquanto o pedido não mudar: tentar de novo não duplica (ADR-0002).
  const [keys] = useState(() => ({ cancel: newIdempotencyKey(), release: newIdempotencyKey(), confirm: newIdempotencyKey() }));

  const customerRef = customers.find((c) => c.id === booking.customer_id);
  const customer = customerRef?.name ?? (booking.customer_id ? "Cliente" : "Sem cliente cadastrado");
  // Pedido pelo link público (P43): nome e WhatsApp que a pessoa informou, para o dono poder falar com ela.
  const [contact, setContact] = useState<PublicBookingContact | null>(null);
  useEffect(() => {
    if (booking.source !== "public_link") return;
    let cancelled = false;
    port.publicContact(booking.id).then((c) => !cancelled && setContact(c), () => undefined);
    return () => {
      cancelled = true;
    };
  }, [port, booking.id, booking.source]);
  const date = localParts(booking.starts_at, tz).date;
  const who = contact?.name ?? customerRef?.name ?? null;

  /** Falha de ação: painel acima do detalhe; dado desatualizado recarrega antes de nova tentativa. */
  function failed(err: unknown, op: Operation) {
    onFailure({ err, op });
    const code = (err as { code?: string }).code;
    if (code === "STALE_VERSION" || code === "IDEMPOTENCY_MISMATCH" || (op === "confirm" && code === "POLICY_REJECTED")) reload();
  }

  async function cancel() {
    const text = reason.trim();
    if (!text) {
      setReasonError("Informe o motivo do cancelamento.");
      requestAnimationFrame(() => document.getElementById("cancel-reason")?.focus());
      throw new Error("motivo");
    }
    onFailure(null);
    try {
      const out = await port.cancel({ booking_id: booking.id, expected_version: booking.version, reason: text }, keys.cancel);
      toast("Atendimento cancelado. O horário voltou a ficar livre.");
      onCancelled({ booking: out, reason: text, contactName: who, phone: contact?.phone_e164 ?? customerRef?.phone ?? null });
      reload();
    } catch (err) {
      failed(err, "cancel");
      throw err;
    }
  }

  async function release() {
    onFailure(null);
    try {
      await port.cancel({ booking_id: booking.id, expected_version: booking.version, reason: FIXED_REASON.releaseHold }, keys.release);
      toast("Horário liberado. O pedido deixou de valer.");
      reload();
    } catch (err) {
      failed(err, "cancel");
      throw err;
    }
  }

  async function confirmHold() {
    setConfirming(true);
    onFailure(null);
    try {
      const out = await port.confirm({ booking_id: booking.id, expected_version: booking.version }, keys.confirm);
      toast(`Reserva confirmada${out.agreed_price_cents !== null ? ` por ${formatCents(out.agreed_price_cents)}` : ""}.`);
      reload();
    } catch (err) {
      failed(err, "confirm");
    } finally {
      setConfirming(false);
    }
  }

  async function revertNoShow() {
    try {
      await port.noShow(
        { booking_id: booking.id, expected_version: booking.version, reason: FIXED_REASON.noShowRevert, revert: true },
        newIdempotencyKey(),
      );
      toast("Falta desfeita. O atendimento voltou a ficar confirmado.");
      reload();
    } catch (err) {
      toastFailure(err, "no_show", reload);
    }
  }

  const holdDeadline =
    booking.status === "held" && booking.hold_expires_at
      ? { time: localParts(booking.hold_expires_at, tz).time, past: Date.parse(booking.hold_expires_at) <= now.getTime() }
      : null;

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
        {contact ? (
          <>
            <dt>Pedido pelo link</dt>
            <dd>
              {contact.name} ·{" "}
              <a href={`https://wa.me/${contact.phone_e164.slice(1)}`} target="_blank" rel="noreferrer">
                <span className="tn-num">{contact.phone_e164}</span>
              </a>
            </dd>
          </>
        ) : null}
        <dt>Preço combinado</dt>
        <dd className="tn-num">{booking.agreed_price_cents === null ? "A definir" : formatCents(booking.agreed_price_cents)}</dd>
        {holdDeadline ? (
          <>
            <dt>Reserva provisória</dt>
            <dd className="tn-num">
              {holdDeadline.past
                ? `Venceu às ${holdDeadline.time}: confirme para tentar manter o horário`
                : `Vence às ${holdDeadline.time} se não for confirmada`}
            </dd>
          </>
        ) : null}
        {booking.status_reason ? (
          <>
            <dt>{booking.status === "no_show" ? "Motivo da falta" : "Motivo do cancelamento"}</dt>
            <dd>{booking.status_reason}</dd>
          </>
        ) : null}
        <dt>Origem</dt>
        <dd>{SOURCE_LABEL[booking.source]}</dd>
      </dl>
      <TimezoneNote timezone={tz} at={booking.starts_at} />

      {canConfirmHold(booking) ? (
        <div className="tn-actions">
          <Button onClick={() => void confirmHold()} loading={confirming} loadingText="Confirmando…">
            Confirmar reserva
          </Button>
          <ConfirmAction
            trigger="Liberar horário"
            title="Liberar este horário?"
            consequence={`O pedido${who ? ` de ${who}` : ""} deixa de valer e o horário ${formatRange(booking, tz)} volta a ficar livre. Nenhuma mensagem é enviada automaticamente.`}
            confirmLabel="Sim, liberar"
            onConfirm={release}
          />
        </div>
      ) : null}

      {canComplete(booking, now) || canMarkNoShow(booking, now) ? <AttendanceActions booking={booking} onChanged={reload} /> : null}

      <div className="tn-actions">
        {canReschedule(booking) ? (
          <Link className="tn-button" data-variant="secondary" to="reagendar">
            Reagendar
          </Link>
        ) : null}
        {booking.status === "completed" ? (
          // Concluir não é receber: a cobrança e o recebimento são registrados no Caixa, pelo dono.
          <Link className="tn-button" data-variant="secondary" to="/app/caixa">
            Cobrar no Caixa
          </Link>
        ) : null}
        {booking.status === "no_show" ? (
          <Button variant="ghost" onClick={() => void revertNoShow()}>
            Desfazer falta
          </Button>
        ) : null}
        {canCancel(booking) && booking.status !== "held" ? (
          <ConfirmAction
            trigger="Cancelar atendimento"
            title="Cancelar este atendimento?"
            consequence={
              <>
                <p>
                  O horário {formatRange(booking, tz)} fica livre para outro cliente. Nenhuma mensagem é enviada
                  automaticamente ao cliente.
                </p>
                <PolicyNote demo={port.kind === "fixture"} />
              </>
            }
            confirmLabel="Sim, cancelar"
            onConfirm={cancel}
          >
            <Field
              as="textarea"
              id="cancel-reason"
              label="Motivo"
              hint="Fica registrado no atendimento. Não vai para o cliente."
              value={reason}
              maxLength={280}
              rows={3}
              error={reasonError}
              onChange={(e) => {
                setReason(e.target.value);
                setReasonError(undefined);
              }}
            />
          </ConfirmAction>
        ) : null}
      </div>
    </div>
  );
}

/** Próximo passo depois de cancelar: o motivo, desfazer, avisar o cliente e oferecer o horário à lista de espera. */
function AfterCancel({ info }: { info: Cancelled }) {
  const port = usePort();
  const navigate = useNavigate();
  const { ctx, services } = useBase();
  const tz = ctx.timezone;
  const b = info.booking;
  const [undoing, setUndoing] = useState(false);
  const [undoError, setUndoError] = useState<unknown>(null);
  const waitlist = useAsync(`waitlist:${b.id}`, () => port.waitlistEntries());
  const start = localParts(b.starts_at, tz);
  const service = serviceName(services, b.service_id);
  // Cancelar antes de o contato do pedido pelo link chegar deixava o aviso sem WhatsApp: busca aqui o que faltou.
  const [late, setLate] = useState<PublicBookingContact | null>(null);
  const needsContact = !info.phone && b.source === "public_link";
  useEffect(() => {
    if (!needsContact) return;
    let stale = false;
    port.publicContact(b.id).then((c) => !stale && setLate(c), () => undefined);
    return () => {
      stale = true;
    };
  }, [port, b.id, needsContact]);
  const digits = whatsAppDigits(info.phone ?? late?.phone_e164 ?? null);
  const notice = cancelNoticeText({ name: info.contactName ?? late?.name ?? null, service, day: formatDayLong(start.date), time: start.time, business: ctx.tenantName });
  const people = waitlist.data ? waitlistMatches(waitlist.data, b.starts_at, tz) : null;

  /** Refaz no mesmo horário, serviço e cliente: cota de novo e cria confirmado. É um atendimento novo (id novo). */
  async function undo() {
    setUndoing(true);
    setUndoError(null);
    try {
      const slot = { starts_at: b.starts_at, ends_at: b.ends_at };
      const quote = await port.quote({ service_id: b.service_id, resource_id: b.resource_id, slot });
      const created = await port.create(
        { customer_id: b.customer_id, guest_ref: null, service_id: b.service_id, resource_id: b.resource_id, slot, quote_id: quote?.quote_id ?? null, mode: "confirm" },
        newIdempotencyKey(),
      );
      const changed = b.agreed_price_cents !== null && created.agreed_price_cents !== null && created.agreed_price_cents !== b.agreed_price_cents;
      navigate(`../${created.id}`, { relative: "path" });
      toast(
        changed
          ? `Cancelamento desfeito: o atendimento foi refeito no mesmo horário, com o valor de hoje (${formatCents(created.agreed_price_cents!)}; antes ${formatCents(b.agreed_price_cents!)}).`
          : "Cancelamento desfeito: o atendimento foi refeito no mesmo horário.",
      );
    } catch (err) {
      setUndoError(err);
    } finally {
      setUndoing(false);
    }
  }

  return (
    <section className="tn-sched-confirm tn-sched-after" aria-labelledby="after-cancel-title">
      <h2 id="after-cancel-title">Atendimento cancelado</h2>
      <p>
        <span className="tn-muted">Motivo:</span> {info.reason}
      </p>
      {undoError ? (
        <div className="tn-stack">
          <ErrorPanel error={undoError} operation="undo_cancel" />
          <Link className="tn-button" data-variant="secondary" to={`../../novo?data=${start.date}`} relative="path">
            Marcar outro horário
          </Link>
        </div>
      ) : null}
      <div className="tn-actions">
        <Button variant="secondary" onClick={() => void undo()} loading={undoing} loadingText="Refazendo…">
          Desfazer
        </Button>
        {digits ? (
          <a
            className="tn-button"
            data-variant="secondary"
            href={`https://wa.me/${digits}?text=${encodeURIComponent(notice)}`}
            target="_blank"
            rel="noreferrer noopener"
          >
            Avisar no WhatsApp
          </a>
        ) : null}
        {people === null ? (
          waitlist.error ? (
            <Link className="tn-button" data-variant="secondary" to="/app/lista-de-espera">
              Ver lista de espera
            </Link>
          ) : null
        ) : people > 0 ? (
          <Link className="tn-button" data-variant="secondary" to="/app/lista-de-espera">
            Oferecer à lista de espera ({people} {people === 1 ? "pessoa" : "pessoas"})
          </Link>
        ) : null}
      </div>
      <p className="tn-muted">
        {people === 0 ? "Ninguém na lista de espera aceita este horário. " : ""}
        {digits ? "O WhatsApp abre com o texto pronto; você revisa e envia." : "Sem WhatsApp no cadastro: avise o cliente pelo canal de sempre."}
      </p>
    </section>
  );
}
