// "Repetir toda semana" no Novo agendamento (decisão D8 a): dias da semana, horário e até quando; a prévia marca as
// datas indisponíveis ANTES de confirmar e nada é criado sem o toque em Confirmar.
// Usa `booking.create_series` como está: uma chamada por dia da semana, cada uma com a sua chave derivada da chave do
// envio. Com `all_or_nothing: false` o servidor cria as datas livres e devolve as que ficaram de fora.
import { type FormEvent, useState } from "react";
import { Link } from "react-router";
import type { Booking, ProviderService, TimeRange } from "@contracts";
import { Button, ChipGroup, Field, Segmented, StatusBanner, useFormErrors, WEEKDAY_CHIPS } from "../../components/ui/index.tsx";
import { useIdempotencyKey } from "../../lib/idempotency.ts";
import { plural, pluralWord } from "../../lib/text/plural.ts";
import { formatCents, formatMinutes, formatRange } from "./agenda.ts";
import { isErrorLike } from "./errors.ts";
import { ErrorPanel, PolicyNote } from "./parts.tsx";
import { useAsync, useBase, usePort } from "./SchedulingLayout.tsx";
import { describeSeries, planSeries, SERIES_MAX_WEEKS, SERIES_MIN_WEEKS, seriesCallKey, type SeriesField, type SeriesPlan } from "./series.ts";
import { formatDayLong, formatDayShort, isCivilDate, localParts, weekdayOf } from "./time.ts";

type Weekday = (typeof WEEKDAY_CHIPS)[number]["value"];
type EndKind = "weeks" | "until";

/** O que a tela mostra depois de confirmar: o que o servidor criou e o que ficou de fora. */
export interface SeriesResult {
  created: Booking[];
  skipped: TimeRange[];
  /** "terça e quinta, às 07:00" */
  description: string;
}

/** Quantas consultas de disponibilidade saem juntas na prévia (uma por data). */
const PREVIEW_BATCH = 8;

/** Falha em que a nova tentativa com a mesma chave pode dar certo (rede, servidor fora, limite de tentativas). */
function canRetry(err: unknown): boolean {
  return !isErrorLike(err) || err.code === "PROVIDER_UNAVAILABLE" || err.code === "INTERNAL_ERROR" || err.code === "QUOTA_EXCEEDED";
}

const byStart = (a: TimeRange, b: TimeRange) => Date.parse(a.starts_at) - Date.parse(b.starts_at);

export function SeriesSection({
  service,
  resourceId,
  date,
  initialTime,
  customerLabel,
  resolveCustomer,
  onDone,
}: {
  service: ProviderService;
  resourceId: string;
  /** Dia escolhido no fluxo: a repetição começa nele ou no primeiro dia marcado depois dele. */
  date: string;
  initialTime: string;
  customerLabel: string;
  /** Confere o cliente no fluxo (mostra o erro lá). null = falta escolher. */
  resolveCustomer: () => { id: string | null } | null;
  onDone: (result: SeriesResult) => void;
}) {
  const port = usePort();
  const { ctx } = useBase();
  const tz = ctx.timezone;
  const [weekdays, setWeekdays] = useState<Weekday[]>([weekdayOf(date) as Weekday]);
  const [time, setTime] = useState(initialTime);
  const [endKind, setEndKind] = useState<EndKind>("weeks");
  const [weeks, setWeeks] = useState("4");
  const [until, setUntil] = useState("");
  const { formRef, errors, show, clear } = useFormErrors<SeriesField>();
  const { keyFor, reset } = useIdempotencyKey();
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<{ err: unknown; createdSoFar: number } | null>(null);
  const [noneCreated, setNoneCreated] = useState(false);

  const plan: SeriesPlan =
    endKind === "until" && !isCivilDate(until)
      ? { ok: false, field: "end", message: "Informe o dia do último atendimento." }
      : planSeries({
          startDate: date,
          weekdays,
          time,
          durationMin: service.duration_min,
          end: endKind === "weeks" ? { kind: "weeks", weeks: Number(weeks) } : { kind: "until", date: until },
          timeZone: tz,
          now: port.now(),
        });
  const occurrences = plan.ok ? plan.occurrences : [];

  // Prévia: uma consulta de disponibilidade por data, na janela exata do atendimento. Livre = o servidor oferece esse
  // início. É só leitura; quem decide de verdade é a criação, e o resultado final vem dela.
  const preview = useAsync(`series:${service.id}:${occurrences.map((o) => o.slot.starts_at).join(",")}`, async () => {
    const free: boolean[] = [];
    for (let i = 0; i < occurrences.length; i += PREVIEW_BATCH) {
      const batch = await Promise.all(
        occurrences.slice(i, i + PREVIEW_BATCH).map(async (o) => {
          const { slots } = await port.availability({ resource_id: resourceId, service_id: service.id, window: o.slot });
          return slots.some((s) => Date.parse(s.starts_at) === Date.parse(o.slot.starts_at));
        }),
      );
      free.push(...batch);
    }
    return free;
  });
  const free = plan.ok ? preview.data : undefined;
  const freeCount = free?.filter(Boolean).length ?? 0;
  const outCount = free ? free.length - freeCount : 0;

  function changed(field: SeriesField) {
    clear(field);
    setNoneCreated(false);
  }

  async function submit(e?: FormEvent<HTMLFormElement>) {
    e?.preventDefault();
    const customer = resolveCustomer();
    const ok = show(plan.ok ? {} : { [plan.field]: plan.message });
    if (!ok || !plan.ok || !customer || !free || freeCount === 0) return;
    // Dia da semana sem nenhuma data livre na prévia não é enviado: o servidor responderia 409 sem criar nada.
    const isFree = new Set(plan.occurrences.filter((_, i) => free[i]).map((o) => o.slot.starts_at));
    const calls = plan.calls.filter((c) => c.occurrences.some((o) => isFree.has(o.slot.starts_at)));
    const payloads = calls.map((c) => ({
      customer_id: customer.id,
      guest_ref: null,
      service_id: service.id,
      resource_id: resourceId,
      slot: c.occurrences[0]!.slot,
      weeks: c.weeks,
      all_or_nothing: false,
    }));
    // Uma chave por envio (mesmo conteúdo, mesma chave; mantida no erro) e, dela, uma por chamada.
    const base = keyFor(payloads);
    const created: Booking[] = [];
    const skipped: TimeRange[] = plan.calls.filter((c) => !calls.includes(c)).flatMap((c) => c.occurrences.map((o) => o.slot));
    setPending(true);
    setFailure(null);
    setNoneCreated(false);
    try {
      for (const [i, call] of calls.entries()) {
        try {
          const out = await port.createSeries(payloads[i]!, seriesCallKey(base, call.weekday));
          created.push(...out.created);
          skipped.push(...out.conflicts);
        } catch (err) {
          // 409 da série: nenhuma data desse dia da semana coube (ocuparam depois da prévia). As outras chamadas seguem.
          if (isErrorLike(err) && err.code === "SLOT_CONFLICT") skipped.push(...call.occurrences.map((o) => o.slot));
          else {
            setFailure({ err, createdSoFar: created.length });
            return;
          }
        }
      }
      // Tudo respondido: o próximo envio, mesmo idêntico, é outra operação.
      reset();
      if (created.length === 0) {
        setNoneCreated(true);
        preview.reload();
        return;
      }
      created.sort(byStart);
      await port.rememberSeries(created.map((b) => b.id));
      onDone({ created, skipped: skipped.sort(byStart), description: describeSeries(weekdays, time) });
    } finally {
      setPending(false);
    }
  }

  const first = occurrences[0];
  const last = occurrences.at(-1);
  const summary = [
    free ? plural(freeCount, "agendamento") : plan.ok ? "conferindo as datas" : "escolha os dias e o horário",
    service.name,
    plan.ok ? time : null,
  ].filter(Boolean).join(" · ");

  return (
    <form ref={formRef} className="tn-sched-series" aria-label="Repetir toda semana" noValidate onSubmit={(e) => void submit(e)}>
      <fieldset className="tn-sched-fieldset">
        <legend>Repetição</legend>
        <ChipGroup
          label="Dias da semana"
          options={WEEKDAY_CHIPS}
          value={weekdays}
          error={errors.weekdays}
          onChange={(v) => {
            setWeekdays(v);
            changed("weekdays");
          }}
        />
        <div className="tn-form-grid">
          <Field label="Horário" id="series-time" type="time" step={900} value={time} error={errors.time}
            hint="O mesmo em todos os dias escolhidos."
            onChange={(e) => {
              setTime(e.target.value);
              changed("time");
            }} />
        </div>
        <Segmented
          label="Até quando"
          value={endKind}
          options={[
            { value: "weeks", label: "Por semanas" },
            { value: "until", label: "Até uma data" },
          ]}
          onChange={(v) => {
            setEndKind(v);
            changed("end");
          }}
        />
        <div className="tn-form-grid">
          {endKind === "weeks" ? (
            <Field label="Quantas semanas" id="series-weeks" type="number" inputMode="numeric" min={SERIES_MIN_WEEKS} max={SERIES_MAX_WEEKS}
              value={weeks} error={errors.end} hint={`De ${SERIES_MIN_WEEKS} a ${SERIES_MAX_WEEKS} semanas por vez.`}
              onChange={(e) => {
                setWeeks(e.target.value);
                changed("end");
              }} />
          ) : (
            <Field label="Último dia" id="series-until" type="date" min={date} value={until} error={errors.end}
              hint={`A repetição vai até ${SERIES_MAX_WEEKS} semanas por vez.`}
              onChange={(e) => {
                setUntil(e.target.value);
                changed("end");
              }} />
          )}
        </div>
      </fieldset>

      {failure ? (
        canRetry(failure.err) ? (
          <div className="tn-sched-error">
            <StatusBanner tone="danger">
              <strong className="tn-sched-error__title">Não deu para concluir a repetição</strong>
              <span className="tn-sched-error__body">
                {failure.createdSoFar > 0
                  ? `Uma parte já foi criada (${plural(failure.createdSoFar, "agendamento")}). `
                  : "Não sabemos se alguma data foi criada. "}
                Tentar de novo é seguro: o pedido usa a mesma chave e não cria nada em dobro.
              </span>
            </StatusBanner>
            <Button variant="secondary" onClick={() => void submit()}>
              Tentar de novo
            </Button>
          </div>
        ) : (
          <ErrorPanel error={failure.err} operation="create" />
        )
      ) : null}
      {noneCreated ? (
        <StatusBanner tone="danger">
          <strong className="tn-sched-error__title">Nenhum agendamento foi criado</strong>
          <span className="tn-sched-error__body">As datas foram ocupadas enquanto você revisava. Atualizamos a lista: escolha outro horário ou outros dias.</span>
        </StatusBanner>
      ) : null}

      <section className="tn-sched-review" aria-labelledby="series-review-title">
        <h2 id="series-review-title">Revise as datas</h2>
        {!plan.ok ? (
          <p className="tn-muted">Escolha os dias da semana, o horário e até quando para ver as datas.</p>
        ) : preview.error ? (
          <ErrorPanel error={preview.error} operation="load" onRetry={preview.reload} />
        ) : !free || !first || !last ? (
          <p role="status" className="tn-sched-loading">
            Conferindo as datas…
          </p>
        ) : (
          <>
            <dl className="tn-sched-dl">
              <dt>Cliente</dt>
              <dd>{customerLabel}</dd>
              <dt>Serviço</dt>
              <dd>
                {service.name} · {formatMinutes(service.duration_min)}
              </dd>
              <dt>Quando</dt>
              <dd className="tn-num">
                Toda semana: {describeSeries(weekdays, time)}. De {formatDayShort(first.date)} a {formatDayShort(last.date)}.
              </dd>
              <dt>Valor</dt>
              <dd className="tn-num">
                <strong>{formatCents(service.base_price_cents)}</strong> por atendimento{" "}
                <span className="tn-muted">Preço base do serviço: a repetição não aplica desconto de horário.</span>
              </dd>
            </dl>
            <p className="tn-sched-series__count" role="status">
              <strong className="tn-num">
                {plural(free.length, "data")}: {freeCount} {pluralWord(freeCount, "livre")}
                {outCount ? ` e ${outCount} ${pluralWord(outCount, "fica", "ficam")} de fora` : ""}.
              </strong>
            </p>
            <ol className="tn-sched-series__dates" aria-label="Datas da repetição">
              {plan.occurrences.map((o, i) => (
                <li key={o.slot.starts_at} data-free={free[i] ? "true" : "false"}>
                  <span className="tn-num">
                    {formatDayShort(o.date)} · {formatRange(o.slot, tz)}
                  </span>
                  <span className="tn-sched-series__state">{free[i] ? "Livre" : "Indisponível: fica de fora"}</span>
                </li>
              ))}
            </ol>
            <p className="tn-muted">
              {outCount
                ? "Indisponível quer dizer horário ocupado, bloqueado ou fora do expediente. Essas datas não são marcadas: combine outro horário para elas. "
                : ""}
              Nada é criado até você confirmar.
            </p>
            {freeCount === 0 ? (
              <StatusBanner tone="warning">Nenhuma data livre neste horário. Troque o horário ou os dias da semana.</StatusBanner>
            ) : null}
            <PolicyNote demo={port.kind === "fixture"} />
          </>
        )}
      </section>

      <div className="tn-sched-confirmbar" role="region" aria-label="Resumo da repetição">
        <Button type="submit" loading={pending || (plan.ok && !free && !preview.error)} loadingText={pending ? "Confirmando…" : "Conferindo…"}
          disabled={plan.ok && (!!preview.error || (!!free && freeCount === 0))}>
          Confirmar{" "}<span className="tn-visually-hidden">repetição</span>
        </Button>
        <p className="tn-sched-confirmbar__summary tn-num" aria-live="polite">
          {summary}
        </p>
      </div>
    </form>
  );
}

/** Depois de confirmar: quantos foram criados e quais datas ficaram de fora, com o caminho para a Agenda. */
export function SeriesDone({ result, customerLabel, serviceLabel }: { result: SeriesResult; customerLabel: string; serviceLabel: string }) {
  const { ctx } = useBase();
  const tz = ctx.timezone;
  const first = result.created[0]!;
  const firstDate = localParts(first.starts_at, tz).date;
  const lastDate = localParts(result.created.at(-1)!.starts_at, tz).date;
  const n = result.created.length;
  return (
    <section className="tn-sched-confirm tn-sched-after" aria-labelledby="series-done-title">
      <h2 id="series-done-title">
        {plural(n, "agendamento criado", "agendamentos criados")}
      </h2>
      <p>
        {customerLabel} · {serviceLabel} · toda semana: {result.description}.{" "}
        <span className="tn-num">
          {n > 1 ? `De ${formatDayLong(firstDate)} a ${formatDayLong(lastDate)}.` : `Em ${formatDayLong(firstDate)}.`}
        </span>
      </p>
      {result.skipped.length ? (
        <>
          <p>
            <strong>{plural(result.skipped.length, "data ficou de fora", "datas ficaram de fora")}</strong>: o horário estava ocupado,
            bloqueado ou fora do expediente. Nada foi marcado {pluralWord(result.skipped.length, "nela", "nelas")}:
          </p>
          <ul className="tn-sched-series__dates" aria-label="Datas que ficaram de fora">
            {result.skipped.map((s) => (
              <li key={s.starts_at} data-free="false">
                <span className="tn-num">
                  {formatDayLong(localParts(s.starts_at, tz).date)}, {formatRange(s, tz)}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p>Nenhuma data ficou de fora.</p>
      )}
      <div className="tn-actions">
        <Link className="tn-button" data-variant="primary" to={`..?data=${firstDate}`} relative="path">
          Ver na agenda
        </Link>
        <Link className="tn-button" data-variant="secondary" to={`../atendimento/${first.id}`} relative="path">
          Abrir o primeiro
        </Link>
      </div>
    </section>
  );
}
