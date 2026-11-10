// Novo agendamento: cliente → serviço → dia/horário → revisão, com a barra "Confirmar" presa ao pé. Reagendamento: dia/horário.
// A cotação não segura o horário; só a confirmação reserva. Conflitos (409) são explicados e
// os horários livres são recarregados sem perder o que já foi escolhido.
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import type { Booking, ProviderService, Quote, TimeRange } from "@contracts";
import { Button, ChoiceCard, Field, focusFirstInvalid, IconButton, PageHeader, StatusBanner, useFormErrors } from "../../components/ui/index.tsx";
import { plural } from "../../lib/text/plural.ts";
import { type CustomerRef, newIdempotencyKey } from "./port.ts";
import { canReschedule, confirmNoticeText, formatCents, formatMinutes, formatPhoneBR, formatRange, phoneToE164, serviceName, whatsAppDigits } from "./agenda.ts";
import { isErrorLike } from "./errors.ts";
import { addDays, dayWindow, formatDayLong, isCivilDate, localParts } from "./time.ts";
import { ErrorPanel, PolicyNote, ScreenNotes } from "./parts.tsx";
import { useAsync, useBase, usePort } from "./SchedulingLayout.tsx";

export function NewBookingPage() {
  const port = usePort();
  const { ctx } = useBase();
  return (
    <section aria-labelledby="flow-title" className="tn-sched">
      <Link to=".." relative="path" className="tn-sched-back">
        ‹ Voltar para a agenda
      </Link>
      <PageHeader id="flow-title" title="Novo agendamento" />
      <ScreenNotes demo={port.kind === "fixture"} timezone={ctx.timezone} at={port.now()} />
      <BookingFlow mode="create" />
    </section>
  );
}

export function ReschedulePage() {
  const { bookingId = "" } = useParams();
  const port = usePort();
  const { ctx } = useBase();
  // Mantém o atendimento anterior enquanto relê (409 de versão): o fluxo fica montado, com a explicação do conflito
  // e o horário escolhido; a próxima tentativa já sai com a versão nova.
  const booking = useAsync(`booking:${bookingId}`, () => port.getBooking(bookingId), true);
  return (
    <section aria-labelledby="flow-title" className="tn-sched">
      <Link to=".." relative="path" className="tn-sched-back">
        ‹ Voltar para o atendimento
      </Link>
      <PageHeader id="flow-title" title="Reagendar atendimento" />
      <ScreenNotes demo={port.kind === "fixture"} timezone={ctx.timezone} at={port.now()} />
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

/** Valor do seletor de cliente para "Sem cadastro": o atendimento fica sem cliente vinculado (customer_id null). */
const NO_CUSTOMER = "sem-cadastro";

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
  const [slotError, setSlotError] = useState<string | undefined>();
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
  // "Agendar" num horário livre da Agenda manda o início do intervalo (ex.: 15:40, fim do atendimento anterior
  // mais o intervalo). Se ele não cai na grade, vale o primeiro horário oferecido a partir dele.
  const timeOf = (s: TimeRange) => localParts(s.starts_at, tz).time;
  const preferredSlot = preferred
    ? (slotList.find((s) => timeOf(s) === preferred) ?? slotList.find((s) => timeOf(s) > preferred) ?? null)
    : null;
  const slot = picked ?? preferredSlot;
  const adjustedFrom = !picked && preferred && preferredSlot && timeOf(preferredSlot) !== preferred ? preferred : null;

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
    if (!service || !resourceId) return;
    const noCustomer = props.mode === "create" && !customerId;
    if (noCustomer) setCustomerError("Escolha o cliente, cadastre um novo ou marque Sem cadastro.");
    if (!slot) setSlotError(slotList.length ? "Escolha um horário." : "Nenhum horário livre neste dia: escolha outro dia.");
    if (noCustomer || !slot) {
      setFocusTick((t) => t + 1);
      return;
    }
    const payload =
      props.mode === "create"
        ? {
            customer_id: customerId === NO_CUSTOMER ? null : customerId,
            guest_ref: null,
            service_id: service.id,
            resource_id: resourceId,
            slot,
            quote_id: q?.quote_id ?? null,
            mode: "confirm" as const,
          }
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
      // O aviso (Toast) sai na tela do atendimento, depois da troca de tela. Com WhatsApp no cadastro, vai junto o texto
      // de confirmação pronto (P49): a tela do atendimento oferece "Avisar no WhatsApp".
      const notify = props.mode === "create" ? createdNotice(result, service, customers.find((c) => c.id === result.customer_id), tz, ctx.tenantName) : null;
      navigate(target, { relative: "path", state: { done: props.mode === "create" ? "criado" : "reagendado", ...(notify ? { notify } : {}) } });
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
  const slotErrorId = "flow-slot-error";
  const price =
    slot && service
      ? quote.data
        ? formatCents(quote.data.final_price_cents)
        : quote.data === null
          ? formatCents(original?.agreed_price_cents ?? service.base_price_cents)
          : null
      : null;
  const summary = [service?.name, slot ? localParts(slot.starts_at, tz).time : "escolha o horário", price].filter(Boolean).join(" · ");

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
        <>
          {/* Ordem do novo agendamento (auditoria de UX, item 29): cliente → serviço → horário. */}
          <CustomerPicker
            customers={customers}
            value={customerId}
            error={customerError}
            onChange={(id) => {
              setCustomerId(id);
              setCustomerError(undefined);
            }}
          />
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
        </>
      )}

      <fieldset className="tn-sched-fieldset">
        <legend>{props.mode === "create" ? "Dia e horário" : "Novo dia e horário"}</legend>
        <div className="tn-sched-dateline">
          <IconButton icon="voltar" variant="secondary" label="Dia anterior" disabled={date <= today} onClick={() => changeDate(addDays(date, -1))} />
          <Field label="Dia" id="flow-date" type="date" value={date} min={today}
            error={slotError && slots.data && slotList.length === 0 ? slotError : undefined}
            onChange={(e) => {
              if (!isCivilDate(e.target.value)) return;
              changeDate(e.target.value);
              setSlotError(undefined);
            }} />
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
          <>
            {adjustedFrom && slot ? (
              <p className="tn-muted" role="status">Primeiro horário possível a partir de {adjustedFrom}: {timeOf(slot)}.</p>
            ) : null}
            <div className="tn-sched-slots" role="group" aria-label="Horários livres">
              {slotList.map((s, i) => {
                const t = localParts(s.starts_at, tz).time;
                return (
                  <button key={s.starts_at} type="button" className="tn-num" aria-pressed={slot?.starts_at === s.starts_at}
                    aria-invalid={slotError && i === 0 ? true : undefined} aria-describedby={slotError && i === 0 ? slotErrorId : undefined}
                    onClick={() => {
                      setPicked(s);
                      setSlotError(undefined);
                    }}>
                    {t}
                  </button>
                );
              })}
            </div>
            {slotError ? <span id={slotErrorId} className="tn-field__error">{slotError}</span> : null}
          </>
        )}
      </fieldset>

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
                {props.mode === "create" ? (
                  <>
                    <dt>Cliente</dt>
                    <dd>
                      {customerId === NO_CUSTOMER
                        ? "Sem cadastro"
                        : (customers.find((c) => c.id === customerId)?.name ?? "Escolha o cliente acima")}
                    </dd>
                  </>
                ) : null}
                <dt>Serviço</dt>
                <dd>
                  {service.name} · {formatMinutes(service.duration_min)}
                </dd>
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
            </>
          )}
        </section>
      ) : null}

      {/*
        Barra de resumo presa ao pé da tela (item 29): "Confirmar · Corte · 13:00 · R$ 51,00". É sticky dentro do fluxo,
        não fixa: no fim da página volta ao lugar e não cobre o conteúdo; no celular para acima da barra de abas. O aviso
        de sucesso (Toast) só sai na tela seguinte, então não disputa este espaço.
      */}
      <div className="tn-sched-confirmbar" role="region" aria-label="Resumo do agendamento">
        <Button onClick={() => void confirm(quote.data ?? null)} loading={pending || (!!slot && quote.data === undefined && !quote.error)}
          loadingText={pending ? "Confirmando…" : "Calculando…"} disabled={!!slot && !!quote.error}>
          Confirmar{" "}<span className="tn-visually-hidden">{props.mode === "create" ? "agendamento" : "reagendamento"}</span>
        </Button>
        <p className="tn-sched-confirmbar__summary tn-num" aria-live="polite">
          {summary}
        </p>
      </div>
    </div>
  );
}

/** Tira acentos e caixa para a busca por nome ("ana" acha "Cliente Exemplo Ána"). */
/** Aviso de confirmação para quem acabou de ser agendado. Sem WhatsApp no cadastro, null (a tela não oferece). */
export interface CreatedNotice {
  bookingId: string;
  phone: string;
  text: string;
}
function createdNotice(booking: Booking, service: ProviderService, customer: CustomerRef | undefined, tz: string, business: string): CreatedNotice | null {
  const phone = whatsAppDigits(customer?.phone);
  if (!customer || !phone) return null;
  const start = localParts(booking.starts_at, tz);
  return { bookingId: booking.id, phone, text: confirmNoticeText({ name: customer.name, service: service.name, day: formatDayLong(start.date), time: start.time, business }) };
}

function fold(v: string): string {
  return v.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("pt-BR");
}

const PICKER_LIMIT = 6;

/**
 * Cliente do novo agendamento: busca por nome ou WhatsApp, "+ Novo cliente" (cadastro rápido com nome e WhatsApp) e
 * "Sem cadastro" (o contrato aceita atendimento sem cliente: customer_id null).
 */
function CustomerPicker({
  customers,
  value,
  error,
  onChange,
}: {
  customers: CustomerRef[];
  value: string;
  error?: string;
  onChange: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const q = fold(query.trim());
  const digits = query.replace(/\D/g, "");
  const matches = customers.filter((c) => !q || fold(c.name).includes(q) || (digits.length >= 3 && (c.phone ?? "").includes(digits)));
  const selected = customers.find((c) => c.id === value);
  // O escolhido fica sempre visível, mesmo fora do filtro.
  const shown = [...(selected && !matches.slice(0, PICKER_LIMIT).includes(selected) ? [selected] : []), ...matches.slice(0, PICKER_LIMIT)];
  const hidden = matches.length - matches.slice(0, PICKER_LIMIT).length;
  const errorId = "flow-customer-error";

  return (
    <fieldset className="tn-sched-fieldset tn-sched-customer">
      <legend>Cliente</legend>
      <div className="tn-sched-customer__search">
        <Field label="Buscar cliente" id="flow-customer-q" type="search" autoComplete="off" value={query}
          aria-describedby="flow-customer-q-help" onChange={(e) => setQuery(e.target.value)} />
        <Button variant="secondary" aria-expanded={creating} onClick={() => setCreating((v) => !v)}>
          + Novo{" "}<span className="tn-visually-hidden">cliente</span>
        </Button>
      </div>
      <p id="flow-customer-q-help" className="tn-muted tn-sched-customer__help">
        {customers.length ? `${plural(customers.length, "cliente")} no cadastro. Busque pelo nome ou pelo WhatsApp.` : "Nenhum cliente no cadastro ainda."}
      </p>
      {creating ? (
        <NewCustomer
          initialName={/\d/.test(query) ? "" : query.trim()}
          onCancel={() => setCreating(false)}
          onCreated={(c, duplicates) => {
            setCreating(false);
            setQuery("");
            onChange(c.id);
            setNote(
              duplicates > 0
                ? `${c.name} foi cadastrado. Há ${plural(duplicates, "cadastro parecido", "cadastros parecidos")}; nada foi mesclado.`
                : `${c.name} foi cadastrado e escolhido.`,
            );
          }}
        />
      ) : null}
      {note ? <p className="tn-muted" role="status">{note}</p> : null}
      <div className="tn-sched-options">
        {shown.map((c, i) => (
          <ChoiceCard key={c.id} name="flow-customer" value={c.id} checked={value === c.id} onChange={() => onChange(c.id)}
            title={c.name} invalid={!!error && i === 0} describedBy={error && i === 0 ? errorId : undefined}
            description={c.phone ? <span className="tn-num">{formatPhoneBR(c.phone)}</span> : undefined} />
        ))}
        {q && matches.length === 0 ? <p className="tn-muted">Nenhum cliente com “{query.trim()}”. Use “+ Novo” para cadastrar.</p> : null}
        {hidden > 0 ? <p className="tn-muted">Mais {plural(hidden, "cliente")}: continue digitando para achar.</p> : null}
        <ChoiceCard name="flow-customer" value={NO_CUSTOMER} checked={value === NO_CUSTOMER} onChange={() => onChange(NO_CUSTOMER)}
          title="Sem cadastro" description="O atendimento fica sem cliente vinculado."
          invalid={!!error && shown.length === 0} describedBy={error && shown.length === 0 ? errorId : undefined} />
      </div>
      {error ? <span id={errorId} className="tn-field__error">{error}</span> : null}
    </fieldset>
  );
}

/** Cadastro rápido: nome e, se quiser, WhatsApp. Grava no cadastro de clientes (CRM) e já escolhe para o agendamento. */
function NewCustomer({
  initialName,
  onCancel,
  onCreated,
}: {
  initialName: string;
  onCancel: () => void;
  onCreated: (c: CustomerRef, duplicates: number) => void;
}) {
  const port = usePort();
  const { addCustomer } = useBase();
  const [name, setName] = useState(initialName);
  const [phone, setPhone] = useState("");
  const { formRef, errors, show } = useFormErrors<"name" | "phone">();
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [attempt, setAttempt] = useState<{ sig: string; key: string } | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFailure(null);
    const e164 = phoneToE164(phone);
    const ok = show({
      name: !name.trim() ? "Informe o nome do cliente." : null,
      phone: e164 === undefined ? "WhatsApp inválido. Use o DDD e o número, como (11) 98765-4321." : null,
    });
    if (!ok || e164 === undefined) return;
    const input = { name: name.trim(), phone: e164 };
    const sig = JSON.stringify(input);
    const key = attempt?.sig === sig ? attempt.key : newIdempotencyKey();
    setAttempt({ sig, key });
    setPending(true);
    try {
      const out = await port.createCustomer(input, key);
      addCustomer(out.customer);
      onCreated(out.customer, out.duplicates);
    } catch {
      setFailure("Não foi possível cadastrar agora. Tentar de novo é seguro: não cria cadastro repetido.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form ref={formRef} className="tn-sched-newcustomer" aria-label="Novo cliente" onSubmit={(e) => void submit(e)} noValidate>
      <div className="tn-form-grid">
        <Field label="Nome" id="nc-name" maxLength={120} autoComplete="off" value={name} error={errors.name} onChange={(e) => setName(e.target.value)} />
        <Field label="WhatsApp" id="nc-phone" type="tel" inputMode="tel" autoComplete="off" hint="Opcional. Com DDD." value={phone} error={errors.phone}
          onChange={(e) => setPhone(e.target.value)} />
      </div>
      {failure ? <StatusBanner tone="danger">{failure}</StatusBanner> : null}
      <div className="tn-actions">
        <Button type="submit" loading={pending} loadingText="Cadastrando…">
          Cadastrar e escolher
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

const REASON_TEXT: Record<Quote["reason_code"], string> = {
  BASE_PRICE: "Preço normal do serviço",
  OFF_PEAK_APPROVED: "Desconto de horário aprovado",
  FLOOR_APPLIED: "Desconto limitado ao menor preço que você aceita",
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
      </span>
      {previous !== null && previous !== quote.final_price_cents ? (
        <span className="tn-sched-price__change">
          Preço combinado hoje: {formatCents(previous)}. Ao confirmar, passa a valer {formatCents(quote.final_price_cents)}.
        </span>
      ) : null}
    </span>
  );
}
