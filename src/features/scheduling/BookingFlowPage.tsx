// Novo agendamento e reagendamento: serviço → dia/horário → cliente → valor → revisão e confirmação.
// A cotação não segura o horário; só a confirmação reserva. Conflitos (409) são explicados e
// os horários livres são recarregados sem perder o que já foi escolhido.
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import type { Booking, ProviderService, Quote, TimeRange } from "@contracts";
import { Button, ChoiceCard, Field, focusFirstInvalid, IconButton, PageHeader, toast } from "../../components/ui/index.tsx";
import { newIdempotencyKey } from "./port.ts";
import { canReschedule, formatCents, formatMinutes, formatRange, serviceName } from "./agenda.ts";
import { isErrorLike } from "./errors.ts";
import { addDays, dayWindow, formatDayLong, isCivilDate, localParts } from "./time.ts";
import { DemoNotice, ErrorPanel, PolicyNote, TimezoneNote } from "./parts.tsx";
import { useAsync, useBase, usePort } from "./SchedulingLayout.tsx";

export function NewBookingPage() {
  const port = usePort();
  return (
    <section aria-labelledby="flow-title" className="tn-sched">
      <Link to=".." relative="path" className="tn-sched-back">
        ‹ Voltar para a agenda
      </Link>
      <PageHeader id="flow-title" title="Novo agendamento" />
      <DemoNotice kind={port.kind} />
      <BookingFlow mode="create" />
    </section>
  );
}

export function ReschedulePage() {
  const { bookingId = "" } = useParams();
  const port = usePort();
  const booking = useAsync(`booking:${bookingId}`, () => port.getBooking(bookingId));
  return (
    <section aria-labelledby="flow-title" className="tn-sched">
      <Link to=".." relative="path" className="tn-sched-back">
        ‹ Voltar para o atendimento
      </Link>
      <PageHeader id="flow-title" title="Reagendar atendimento" />
      <DemoNotice kind={port.kind} />
      {booking.error ? (
        <ErrorPanel error={booking.error} operation="load" onRetry={booking.reload} />
      ) : !booking.data ? (
        <p role="status" className="tn-sched-loading">
          Carregando atendimento…
        </p>
      ) : !canReschedule(booking.data) ? (
        <p>Este atendimento não pode mais ser reagendado.</p>
      ) : (
        <BookingFlow mode="reschedule" booking={booking.data} reloadBooking={booking.reload} />
      )}
    </section>
  );
}

type FlowProps = { mode: "create" } | { mode: "reschedule"; booking: Booking; reloadBooking: () => void };

function BookingFlow(props: FlowProps) {
  const port = usePort();
  const navigate = useNavigate();
  const { ctx, services, customers } = useBase();
  const [params] = useSearchParams();
  const tz = ctx.timezone;
  const today = localParts(port.now(), tz).date;
  const original = props.mode === "reschedule" ? props.booking : null;

  const [serviceId, setServiceId] = useState<string>(original?.service_id ?? services[0]?.id ?? "");
  const [date, setDate] = useState<string>(() => {
    const d = params.get("data");
    if (original) return localParts(original.starts_at, tz).date;
    return isCivilDate(d) && d >= today ? d : today;
  });
  const [preferred, setPreferred] = useState<string | null>(props.mode === "create" ? params.get("inicio") : null);
  const [picked, setPicked] = useState<TimeRange | null>(null);
  const [customerId, setCustomerId] = useState<string>("");
  const [customerError, setCustomerError] = useState<string | undefined>();
  const [attempt, setAttempt] = useState<{ sig: string; key: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  // Validação no envio: o foco vai para o primeiro campo com erro (item 15 da auditoria).
  const flowRef = useRef<HTMLDivElement>(null);
  const [focusTick, setFocusTick] = useState(0);
  useEffect(() => {
    if (focusTick) focusFirstInvalid(flowRef.current);
  }, [focusTick]);

  const service = services.find((s) => s.id === serviceId);
  const resourceId = original?.resource_id ?? ctx.resourceId;

  const slots = useAsync(`slots:${serviceId}:${date}`, async () => {
    if (!resourceId) throw new Error("Recurso do negócio não informado.");
    return port.availability({ resource_id: resourceId, service_id: serviceId, window: dayWindow(date, tz) });
  });
  const slotList = slots.data?.slots ?? [];
  const slot =
    picked ?? (preferred ? (slotList.find((s) => localParts(s.starts_at, tz).time === preferred) ?? null) : null);

  const quote = useAsync(`quote:${serviceId}:${slot?.starts_at ?? "-"}`, async () => {
    if (!slot || !resourceId) return null;
    return port.quote({ service_id: serviceId, resource_id: resourceId, slot });
  });

  function changeDate(next: string) {
    setDate(next);
    setPicked(null);
    setPreferred(null);
  }

  /** q = null: sem regras de preço ligadas (P05); o servidor congela o preço base do serviço. */
  async function confirm(q: Quote | null) {
    if (!slot || !service || !resourceId) return;
    if (props.mode === "create" && !customerId) {
      setCustomerError("Escolha o cliente.");
      setFocusTick((t) => t + 1);
      return;
    }
    const payload =
      props.mode === "create"
        ? { customer_id: customerId, guest_ref: null, service_id: service.id, resource_id: resourceId, slot, quote_id: q?.quote_id ?? null, mode: "confirm" as const }
        : { booking_id: props.booking.id, expected_version: props.booking.version, slot, quote_id: q?.quote_id ?? null };
    const sig = JSON.stringify(payload);
    // Mesma chave para o mesmo pedido (repetir não duplica); pedido diferente, chave nova.
    const key = attempt?.sig === sig ? attempt.key : newIdempotencyKey();
    setAttempt({ sig, key });
    setPending(true);
    setFailure(null);
    try {
      const result =
        props.mode === "create"
          ? await port.create(payload as Parameters<typeof port.create>[0], key)
          : await port.reschedule(payload as Parameters<typeof port.reschedule>[0], key);
      const target = props.mode === "create" ? `../atendimento/${result.id}` : "..";
      toast(props.mode === "create" ? "Agendamento confirmado." : "Atendimento reagendado.");
      navigate(target, { relative: "path" });
    } catch (err) {
      setFailure(err);
      const code = isErrorLike(err) ? err.code : null;
      if (code === "SLOT_CONFLICT") {
        setPicked(null);
        setPreferred(null);
        slots.reload();
      } else if (code === "STALE_VERSION" && props.mode === "reschedule") {
        props.reloadBooking();
      } else if (code === "POLICY_REJECTED") {
        quote.reload();
      }
    } finally {
      setPending(false);
    }
  }

  const op = props.mode === "create" ? "create" : "reschedule";

  return (
    <div className="tn-sched-flow" ref={flowRef}>
      {failure ? (
        <ErrorPanel error={failure} operation={op} onRetry={quote.data !== undefined ? () => void confirm(quote.data ?? null) : undefined} />
      ) : null}

      {props.mode === "reschedule" ? (
        <p className="tn-sched-current">
          Horário atual: <strong className="tn-num">{formatDayLong(localParts(props.booking.starts_at, tz).date)}, {formatRange(props.booking, tz)}</strong> ·{" "}
          {serviceName(services, props.booking.service_id)}
        </p>
      ) : (
        <fieldset className="tn-sched-fieldset">
          <legend>Serviço</legend>
          <div className="tn-sched-options">
            {services.map((s) => (
              <ChoiceCard
                key={s.id}
                name="flow-service"
                value={s.id}
                checked={s.id === serviceId}
                onChange={() => {
                  setServiceId(s.id);
                  setPicked(null);
                }}
                title={s.name}
                description={<span className="tn-num">{formatMinutes(s.duration_min)} · a partir de {formatCents(s.base_price_cents)}</span>}
              />
            ))}
          </div>
        </fieldset>
      )}

      <fieldset className="tn-sched-fieldset">
        <legend>{props.mode === "create" ? "Dia e horário" : "Novo dia e horário"}</legend>
        <div className="tn-sched-dateline">
          <IconButton icon="seta" data-dir="prev" variant="secondary" label="Dia anterior" disabled={date <= today} onClick={() => changeDate(addDays(date, -1))} />
          <Field label="Dia" id="flow-date" type="date" value={date} min={today} onChange={(e) => isCivilDate(e.target.value) && changeDate(e.target.value)} />
          <IconButton icon="seta" variant="secondary" label="Próximo dia" onClick={() => changeDate(addDays(date, 1))} />
        </div>
        <p className="tn-muted">{formatDayLong(date)}</p>
        {slots.error ? (
          <ErrorPanel error={slots.error} operation="load" onRetry={slots.reload} />
        ) : !slots.data ? (
          <p role="status" className="tn-sched-loading">
            Buscando horários livres…
          </p>
        ) : slotList.length === 0 ? (
          <p className="tn-sched-empty">Nenhum horário livre neste dia. Tente outro dia.</p>
        ) : (
          <div className="tn-sched-slots" role="group" aria-label="Horários livres">
            {slotList.map((s) => {
              const t = localParts(s.starts_at, tz).time;
              return (
                <button key={s.starts_at} type="button" className="tn-num" aria-pressed={slot?.starts_at === s.starts_at} onClick={() => setPicked(s)}>
                  {t}
                </button>
              );
            })}
          </div>
        )}
        <TimezoneNote timezone={tz} at={dayWindow(date, tz).starts_at} />
      </fieldset>

      {props.mode === "create" ? (
        <Field
          as="select"
          label="Cliente"
          id="flow-customer"
          value={customerId}
          error={customerError}
          onChange={(e) => {
            setCustomerId(e.target.value);
            setCustomerError(undefined);
          }}
        >
          <option value="">Escolha…</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Field>
      ) : null}

      {slot && service ? (
        <section className="tn-sched-review" aria-labelledby="review-title">
          <h2 id="review-title">Revise e confirme</h2>
          {quote.error ? (
            <ErrorPanel error={quote.error} operation="load" onRetry={quote.reload} />
          ) : quote.data === undefined ? (
            <p role="status" className="tn-sched-loading">
              Calculando o valor…
            </p>
          ) : (
            <>
              <dl className="tn-sched-dl">
                <dt>Serviço</dt>
                <dd>
                  {service.name} · {formatMinutes(service.duration_min)}
                </dd>
                {props.mode === "create" ? (
                  <>
                    <dt>Cliente</dt>
                    <dd>{customers.find((c) => c.id === customerId)?.name ?? "Escolha o cliente acima"}</dd>
                  </>
                ) : null}
                <dt>Quando</dt>
                <dd className="tn-num">
                  {formatDayLong(date)}, {formatRange(slot, tz)}
                </dd>
                <dt>Valor</dt>
                <dd className="tn-num">
                  {quote.data ? (
                    <PriceLine quote={quote.data} previous={original?.agreed_price_cents ?? null} />
                  ) : (
                    <BasePriceLine service={service} previous={original?.agreed_price_cents ?? null} reschedule={props.mode === "reschedule"} />
                  )}
                </dd>
              </dl>
              <p className="tn-muted">
                {quote.data ? `Valor válido até ${localParts(quote.data.expires_at, tz).time}. ` : ""}
                Ver o valor não segura o horário: ele só fica reservado quando você confirmar.
              </p>
              <PolicyNote demo={port.kind === "fixture"} />
              <div className="tn-actions">
                <Button onClick={() => void confirm(quote.data ?? null)} loading={pending} loadingText="Confirmando…">
                  {props.mode === "create" ? "Confirmar agendamento" : "Confirmar reagendamento"}
                </Button>
              </div>
            </>
          )}
        </section>
      ) : null}
    </div>
  );
}

const REASON_TEXT: Record<Quote["reason_code"], string> = {
  BASE_PRICE: "Preço normal do serviço",
  OFF_PEAK_APPROVED: "Desconto de horário aprovado",
  FLOOR_APPLIED: "Desconto limitado ao preço mínimo",
};

/** Sem cotação (regras de preço ainda não ligadas): preço base; no reagendamento o combinado é mantido. */
function BasePriceLine({ service, previous, reschedule }: { service: ProviderService; previous: number | null; reschedule: boolean }) {
  if (reschedule && previous !== null) {
    return (
      <span>
        <strong>{formatCents(previous)}</strong> <span className="tn-muted">Preço combinado mantido.</span>
      </span>
    );
  }
  return (
    <span>
      <strong>{formatCents(service.base_price_cents)}</strong>{" "}
      <span className="tn-muted">Preço base do serviço. Regras de preço por horário ainda não estão ligadas.</span>
    </span>
  );
}

function PriceLine({ quote, previous }: { quote: Quote; previous: number | null }) {
  const discounted = quote.final_price_cents !== quote.base_price_cents;
  return (
    <span className="tn-sched-price">
      <strong>{formatCents(quote.final_price_cents)}</strong>
      {discounted ? (
        <span className="tn-muted">
          {" "}
          (de <s>{formatCents(quote.base_price_cents)}</s>)
        </span>
      ) : null}
      <span className="tn-muted">
        {" · "}
        {REASON_TEXT[quote.reason_code]}
        {quote.rule_version ? ` (regra v${quote.rule_version})` : ""}
      </span>
      {previous !== null && previous !== quote.final_price_cents ? (
        <span className="tn-sched-price__change">
          Preço combinado hoje: {formatCents(previous)}. Ao confirmar, passa a valer {formatCents(quote.final_price_cents)}.
        </span>
      ) : null}
    </span>
  );
}
