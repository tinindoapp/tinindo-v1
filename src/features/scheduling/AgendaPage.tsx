// Tela principal da agenda: Hoje/dia e semana, ocupação e horários livres.
// P54 (parte 2): abertura no padrão do kit (título, fuso como linha de apoio, Dia/Semana e as setas como filtro) e o
// dia numa linha curta ("Hoje · ter., 20/10") com a ocupação ao lado, para o terceiro atendimento caber na primeira
// tela do celular.
import { Icon } from "../../components/ui/icons.tsx";
import { Button, IconButton, PageHeader, Segmented, SetupHint } from "../../components/ui/index.tsx";
import { Link, useSearchParams } from "react-router";
import type { Booking, ProviderService } from "@contracts";
import {
  canComplete,
  dayTimeline,
  type DayPlan,
  formatCents,
  formatMinutes,
  formatRange,
  occupancy,
  serviceName,
} from "./agenda.ts";
import { seriesLabel, seriesMark } from "./series.ts";
import { addDays, dayWindow, formatDayLong, formatDayShort, formatWeekdayDay, isCivilDate, localParts, weekStart } from "./time.ts";
import { ErrorPanel, ListStatusBadge, useSchedulingExtensions, zoneLine } from "./parts.tsx";
import { useAsync, useBase, usePort } from "./SchedulingLayout.tsx";
import { AttendanceActions } from "./attendance.tsx";
import { pluralWord } from "../../lib/text/plural.ts";

type View = "dia" | "semana";

export function AgendaPage() {
  const port = usePort();
  const { ctx } = useBase();
  const [params, setParams] = useSearchParams();
  const tz = ctx.timezone;
  const today = localParts(port.now(), tz).date;
  const date = isCivilDate(params.get("data")) ? params.get("data")! : today;
  const view: View = params.get("visao") === "semana" ? "semana" : "dia";

  const go = (next: { data?: string; visao?: View }) => {
    const p = new URLSearchParams(params);
    if (next.data) p.set("data", next.data);
    if (next.visao) p.set("visao", next.visao);
    setParams(p);
  };
  const step = view === "semana" ? 7 : 1;
  const first = view === "semana" ? weekStart(date) : date;

  return (
    <section aria-labelledby="agenda-title" className="tn-sched tn-sched--agenda">
      <PageHeader
        id="agenda-title"
        title="Agenda"
        subtitle={zoneLine(tz, dayWindow(first, tz).starts_at) ?? undefined}
        actions={
          // No celular vira botão flutuante redondo (só o +) acima das abas; no desktop fica ao lado do título.
          <Link className="tn-button tn-sched-new" data-variant="primary" to={`novo?data=${date}`}>
            <Icon name="mais" size={20} />
            <span className="tn-sched-new__label">Novo agendamento</span>
          </Link>
        }
        filter={
          <>
            <Segmented
              label="Visualização"
              hideLabel
              value={view}
              options={[
                { value: "dia", label: "Dia" },
                { value: "semana", label: "Semana" },
              ]}
              onChange={(v) => go({ visao: v })}
            />
            <div className="tn-sched-datenav" role="group" aria-label="Navegar nas datas">
              <IconButton icon="voltar" variant="secondary" label={view === "semana" ? "Semana anterior" : "Dia anterior"}
                onClick={() => go({ data: addDays(date, -step) })} />
              <Button variant="secondary" size="compact" onClick={() => go({ data: today })} aria-current={date === today ? "date" : undefined}>
                Hoje
              </Button>
              <IconButton icon="seta" variant="secondary" label={view === "semana" ? "Próxima semana" : "Próximo dia"}
                onClick={() => go({ data: addDays(date, step) })} />
            </div>
          </>
        }
      />

      {view === "dia" ? (
        <DayView date={date} isToday={date === today} />
      ) : (
        <WeekView first={first} today={today} onPick={(d) => go({ data: d, visao: "dia" })} />
      )}
    </section>
  );
}

function useRange(first: string, days: number) {
  const port = usePort();
  const { ctx } = useBase();
  const window = dayWindow(first, ctx.timezone, days);
  return useAsync(
    `range:${first}:${days}`,
    async () => {
      const [bookings, plans] = await Promise.all([port.listBookings(window), port.dayPlans(window)]);
      return { bookings, plans };
    },
    true,
  );
}

function DayView({ date, isToday }: { date: string; isToday: boolean }) {
  const port = usePort();
  const { ctx, services, customers } = useBase();
  const ext = useSchedulingExtensions();
  const range = useRange(date, 1);
  // Repetições dos atendimentos do dia (series_id vem do servidor): lê cada série uma vez, só para "3 de 16" no cartão.
  // Se a leitura falhar, o cartão diz só "Repete toda semana".
  const seriesIds = [...new Set((range.data?.bookings ?? []).map((b) => b.series_id).filter((x): x is string => !!x))].sort();
  const series = useAsync(`series:${seriesIds.join(",")}`, () =>
    Promise.all(seriesIds.map((id) => port.series(id).catch(() => [] as Booking[]))).then((lists) => lists.flat()));
  const tz = ctx.timezone;
  // Linha curta ("Hoje · ter., 20/10"); o dia por extenso fica para o leitor de tela.
  const title = `${isToday ? "Hoje · " : ""}${formatDayShort(date)}`;

  return (
    <div className="tn-sched-day">
      <h2 className="tn-sched-daytitle tn-num">
        <span aria-hidden="true">{title}</span>
        <span className="tn-visually-hidden">{isToday ? "Hoje, " : ""}{formatDayLong(date)}</span>
      </h2>
      {range.error ? (
        <ErrorPanel error={range.error} operation="load" onRetry={range.reload} />
      ) : !range.data ? (
        <p role="status" className="tn-sched-loading">
          Carregando o dia…
        </p>
      ) : (
        <>
          <OccupancyLine plans={range.data.plans} bookings={range.data.bookings} label="Ocupação do dia" more="Ver números do dia" />
          <DayList date={date} plan={range.data.plans?.[0] ?? null} bookings={range.data.bookings} tz={tz} services={services}
            serviceOf={(id) => serviceName(services, id)}
            customerOf={(id) => customers.find((c) => c.id === id)?.name ?? (id ? "Cliente" : "Sem cliente cadastrado")}
            freeActions={ext.freeSlotActions}
            seriesOf={(id) => {
              const own = range.data?.bookings.find((b) => b.id === id);
              if (!own?.series_id) return null;
              const mark = seriesMark((series.data ?? []).filter((b) => b.series_id === own.series_id), id);
              return mark ? seriesLabel(mark) : "Repete toda semana";
            }}
            now={port.now()}
            reload={range.reload}
          />
        </>
      )}
    </div>
  );
}

/** Ocupação numa linha compacta acima da lista (a lista do dia aparece sem rolar no celular); números em "Ver números". */
function OccupancyLine({ plans, bookings, label, more }: { plans: DayPlan[] | null; bookings: Booking[]; label: string; more: string }) {
  if (!plans) {
    return (
      <p className="tn-sched-occline tn-muted" aria-label={label}>
        Ocupação indisponível: o expediente ainda não vem do servidor.
      </p>
    );
  }
  const o = occupancy(plans, bookings);
  return (
    <div className="tn-sched-occline" role="group" aria-label={label}>
      {o.percent === null ? (
        <p className="tn-sched-occline__figure tn-muted">Sem expediente neste período.</p>
      ) : (
        <>
          {/* Só o percentual na linha; minutos confirmados e livres ficam em "Ver números" (cabe numa linha em 390 px). */}
          <p className="tn-sched-occline__figure tn-num">
            <strong>{o.percent}% ocupado</strong>
          </p>
          <meter className="tn-sched-meter" min={0} max={o.sellableMinutes} value={o.confirmedMinutes} aria-label={`Ocupação ${o.percent}%`} />
        </>
      )}
      <details className="tn-sched-occline__more">
        <summary>{more}</summary>
        <ul className="tn-sched-occ-details">
          {o.percent !== null ? (
            <li>Confirmados: {formatMinutes(o.confirmedMinutes)} de {formatMinutes(o.sellableMinutes)} livres para agendar</li>
          ) : null}
          <li>Bloqueios: {formatMinutes(o.blockedMinutes)}</li>
          <li>Reservas provisórias (não contam): {o.holds}</li>
          <li>Faltas: {o.noShows}</li>
          <li>Cancelamentos: {o.cancellations}</li>
        </ul>
      </details>
    </div>
  );
}

function DayList({
  date,
  plan,
  bookings,
  tz,
  services,
  serviceOf,
  customerOf,
  freeActions,
  seriesOf,
  now,
  reload,
}: {
  date: string;
  plan: DayPlan | null;
  bookings: Booking[];
  tz: string;
  services: ProviderService[];
  serviceOf: (id: string) => string;
  customerOf: (id: string | null) => string;
  freeActions?: ReturnType<typeof useSchedulingExtensions>["freeSlotActions"];
  /** "Repete toda semana · 3 de 16" quando o atendimento faz parte de uma repetição conhecida. */
  seriesOf: (id: string) => string | null;
  now: Date;
  reload: () => void;
}) {
  const items = dayTimeline(plan, bookings, 20, services);
  if (plan && plan.open.length === 0 && bookings.length === 0) {
    return (
      <>
        <p className="tn-sched-empty">Sem expediente neste dia.</p>
        <SetupHint to="/app/agenda/horarios" action="Definir horários">
          Se você atende neste dia, defina o expediente: ele abre a agenda e os horários do link público.
        </SetupHint>
      </>
    );
  }
  if (items.length === 0) return <p className="tn-sched-empty">Nenhum atendimento neste dia.</p>;
  return (
    <ol className="tn-sched-timeline" aria-label={`Linha do tempo de ${formatDayLong(date)}`}>
      {items.map((item) => {
        const time = <span className="tn-sched-time tn-num">{formatRange(item.range, tz)}</span>;
        if (item.kind === "booking") {
          const b = item.booking;
          return (
            <li key={b.id} className="tn-sched-item" data-kind="booking" data-status={b.status}>
              <Link to={`atendimento/${b.id}`} className="tn-sched-item__link">
                {time}
                <span className="tn-sched-item__main">
                  <span className="tn-sched-item__title">{serviceOf(b.service_id)}</span>
                  <span className="tn-muted">{customerOf(b.customer_id)}</span>
                  {seriesOf(b.id) ? <span className="tn-muted tn-num">{seriesOf(b.id)}</span> : null}
                </span>
                <span className="tn-sched-item__side">
                  <ListStatusBadge status={b.status} />
                  {b.agreed_price_cents !== null ? <span className="tn-num">{formatCents(b.agreed_price_cents)}</span> : null}
                </span>
              </Link>
              {/* Depois do início: Atendido e Faltou no próprio cartão, fora do link (botão dentro de link não é permitido). */}
              {canComplete(b, now) ? (
                <AttendanceActions booking={b} when={`às ${localParts(b.starts_at, tz).time}`} onChanged={reload} />
              ) : null}
            </li>
          );
        }
        if (item.kind === "free") {
          const start = localParts(item.range.starts_at, tz).time;
          return (
            <li key={`free-${item.range.starts_at}`} className="tn-sched-item" data-kind="free">
              {time}
              <span className="tn-sched-item__main">
                <span className="tn-sched-item__title">Horário livre</span>
                <span className="tn-muted">{formatMinutes(item.minutes)}</span>
              </span>
              <span className="tn-sched-item__side">
                {freeActions?.(item.range)}
                <Link to={`novo?data=${date}&inicio=${start}`} className="tn-sched-linkbtn">
                  Agendar<span className="tn-visually-hidden"> às {start}</span>
                </Link>
              </span>
            </li>
          );
        }
        return (
          <li key={`${item.kind}-${item.range.starts_at}`} className="tn-sched-item" data-kind={item.kind}>
            {time}
            <span className="tn-sched-item__main">
              <span className="tn-sched-item__title">{item.kind === "pause" ? "Pausa" : `Bloqueado · ${item.label}`}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function WeekView({ first, today, onPick }: { first: string; today: string; onPick: (d: string) => void }) {
  const { ctx } = useBase();
  const range = useRange(first, 7);
  const days = Array.from({ length: 7 }, (_, i) => addDays(first, i));
  if (range.error) return <ErrorPanel error={range.error} operation="load" onRetry={range.reload} />;
  if (!range.data) {
    return (
      <p role="status" className="tn-sched-loading">
        Carregando a semana…
      </p>
    );
  }
  const { bookings, plans } = range.data;
  const ofDay = (d: string) => bookings.filter((b) => localParts(b.starts_at, ctx.timezone).date === d);
  return (
    <div className="tn-sched-week">
      <h2 className="tn-sched-daytitle">
        Semana de {formatDayShort(first)} a {formatDayShort(addDays(first, 6))}
      </h2>
      <OccupancyLine plans={plans} bookings={bookings} label="Ocupação da semana" more="Ver números da semana" />
      <ul className="tn-sched-weekdays">
        {days.map((d) => {
          const list = ofDay(d);
          const plan = plans?.find((p) => p.date === d);
          const o = plan ? occupancy([plan], list) : null;
          const active = list.filter((b) => b.status === "confirmed" || b.status === "held" || b.status === "completed").length;
          const closed = plan ? plan.open.length === 0 : false;
          return (
            <li key={d}>
              {/* "Seg 19" sem quebra à esquerda; "2 · 9%" e a seta à direita (auditoria de UX, item 32). */}
              <button type="button" className="tn-sched-weekday" onClick={() => onPick(d)} aria-current={d === today ? "date" : undefined}>
                <span className="tn-sched-weekday__day">
                  <span className="tn-sched-item__title tn-num" aria-hidden="true">{formatWeekdayDay(d)}</span>
                  <span className="tn-visually-hidden">{formatDayLong(d)}</span>{" "}
                  {d === today ? <span className="tn-sched-weekday__today">Hoje</span> : null}
                </span>{" "}
                <span className="tn-sched-weekday__side tn-num" data-quiet={closed || active === 0 ? "true" : undefined}>
                  {closed ? (
                    "Fechado"
                  ) : active === 0 ? (
                    "Livre"
                  ) : (
                    <>
                      {active}{" "}
                      <span className="tn-visually-hidden">{pluralWord(active, "atendimento")}</span>
                      {o?.percent != null ? (
                        <>
                          {" · "}
                          {o.percent}%{" "}<span className="tn-visually-hidden">ocupado</span>
                        </>
                      ) : null}
                    </>
                  )}
                  <Icon name="seta" size={18} className="tn-sched-weekday__chevron" />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
