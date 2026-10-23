// Tela principal da agenda: Hoje/dia e semana, ocupação e horários livres.
import { Icon } from "../../components/ui/icons.tsx";
import { Link, useSearchParams } from "react-router";
import type { Booking, ProviderService } from "@contracts";
import {
  dayTimeline,
  type DayPlan,
  formatCents,
  formatMinutes,
  formatRange,
  occupancy,
  type Occupancy,
  serviceName,
} from "./agenda.ts";
import { addDays, dayWindow, formatDayLong, formatDayShort, isCivilDate, localParts, weekStart } from "./time.ts";
import { DemoNotice, ErrorPanel, StatusBadge, TimezoneNote, useSchedulingExtensions } from "./parts.tsx";
import { useAsync, useBase, usePort } from "./SchedulingLayout.tsx";

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
    <section aria-labelledby="agenda-title" className="tn-sched">
      <h1 id="agenda-title">Agenda</h1>
      <DemoNotice kind={port.kind} />

      <div className="tn-sched-toolbar">
        <div className="tn-sched-segmented" role="group" aria-label="Visualização">
          <button type="button" aria-pressed={view === "dia"} onClick={() => go({ visao: "dia" })}>
            Dia
          </button>
          <button type="button" aria-pressed={view === "semana"} onClick={() => go({ visao: "semana" })}>
            Semana
          </button>
        </div>
        <div className="tn-sched-datenav" role="group" aria-label="Navegar nas datas">
          <button type="button" onClick={() => go({ data: addDays(date, -step) })} aria-label={view === "semana" ? "Semana anterior" : "Dia anterior"}>
            ‹
          </button>
          <button type="button" onClick={() => go({ data: today })} aria-pressed={date === today}>
            Hoje
          </button>
          <button type="button" onClick={() => go({ data: addDays(date, step) })} aria-label={view === "semana" ? "Próxima semana" : "Próximo dia"}>
            ›
          </button>
        </div>
        {/* No celular vira botão flutuante acima das abas; no desktop fica na barra. Mesmo elemento nos dois. */}
        <Link className="tn-button tn-sched-new" data-variant="primary" to={`novo?data=${date}`}>
          <Icon name="mais" size={20} />
          Novo agendamento
        </Link>
      </div>

      {view === "dia" ? (
        <DayView date={date} isToday={date === today} demo={port.kind === "fixture"} />
      ) : (
        <WeekView first={first} today={today} onPick={(d) => go({ data: d, visao: "dia" })} />
      )}
      <TimezoneNote timezone={tz} at={dayWindow(first, tz).starts_at} />
    </section>
  );
}

function useRange(first: string, days: number) {
  const port = usePort();
  const { ctx } = useBase();
  const window = dayWindow(first, ctx.timezone, days);
  return useAsync(`range:${first}:${days}`, async () => {
    const [bookings, plans] = await Promise.all([port.listBookings(window), port.dayPlans(window)]);
    return { bookings, plans };
  });
}

function DayView({ date, isToday, demo }: { date: string; isToday: boolean; demo: boolean }) {
  const { ctx, services, customers } = useBase();
  const ext = useSchedulingExtensions();
  const range = useRange(date, 1);
  const tz = ctx.timezone;
  const title = `${isToday ? "Hoje · " : ""}${formatDayLong(date)}`;

  return (
    <div className="tn-sched-day">
      <h2 className="tn-sched-daytitle">
        {title}
        {isToday && demo ? <span className="tn-sched-muted"> (data da demonstração)</span> : null}
      </h2>
      {range.error ? (
        <ErrorPanel error={range.error} operation="load" onRetry={range.reload} />
      ) : !range.data ? (
        <p role="status" className="tn-sched-loading">
          Carregando o dia…
        </p>
      ) : (
        <>
          <OccupancyCard plans={range.data.plans} bookings={range.data.bookings} label="Ocupação do dia" />
          <DayList date={date} plan={range.data.plans?.[0] ?? null} bookings={range.data.bookings} tz={tz} services={services}
            serviceOf={(id) => serviceName(services, id)}
            customerOf={(id) => customers.find((c) => c.id === id)?.name ?? (id ? "Cliente" : "Sem cliente cadastrado")}
            freeActions={ext.freeSlotActions}
          />
        </>
      )}
    </div>
  );
}

function OccupancyCard({ plans, bookings, label }: { plans: DayPlan[] | null; bookings: Booking[]; label: string }) {
  if (!plans) {
    return (
      <div className="tn-sched-occupancy">
        <h3>{label}</h3>
        <p className="tn-sched-muted">Ocupação indisponível: o expediente ainda não vem do servidor.</p>
      </div>
    );
  }
  const o = occupancy(plans, bookings);
  return (
    <div className="tn-sched-occupancy">
      <h3>{label}</h3>
      <OccupancySummary o={o} />
      <ul className="tn-sched-occ-details">
        <li>Bloqueios: {formatMinutes(o.blockedMinutes)}</li>
        <li>Reservas provisórias (não contam): {o.holds}</li>
        <li>Faltas: {o.noShows}</li>
        <li>Cancelamentos: {o.cancellations}</li>
      </ul>
    </div>
  );
}

function OccupancySummary({ o }: { o: Occupancy }) {
  if (o.percent === null) return <p className="tn-sched-muted">Sem expediente neste período.</p>;
  return (
    <>
      <p className="tn-sched-occ-figure tn-num">
        <strong>{o.percent}%</strong> · {formatMinutes(o.confirmedMinutes)} confirmados de {formatMinutes(o.sellableMinutes)} vendáveis
      </p>
      <meter className="tn-sched-meter" min={0} max={o.sellableMinutes} value={o.confirmedMinutes} aria-label={`Ocupação ${o.percent}%`} />
    </>
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
}: {
  date: string;
  plan: DayPlan | null;
  bookings: Booking[];
  tz: string;
  services: ProviderService[];
  serviceOf: (id: string) => string;
  customerOf: (id: string | null) => string;
  freeActions?: ReturnType<typeof useSchedulingExtensions>["freeSlotActions"];
}) {
  const items = dayTimeline(plan, bookings, 20, services);
  if (plan && plan.open.length === 0 && bookings.length === 0) {
    return <p className="tn-sched-empty">Sem expediente neste dia.</p>;
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
                  <span className="tn-sched-muted">{customerOf(b.customer_id)}</span>
                </span>
                <span className="tn-sched-item__side">
                  <StatusBadge status={b.status} />
                  {b.agreed_price_cents !== null ? <span className="tn-num">{formatCents(b.agreed_price_cents)}</span> : null}
                </span>
              </Link>
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
                <span className="tn-sched-muted">{formatMinutes(item.minutes)}</span>
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
      <OccupancyCard plans={plans} bookings={bookings} label="Ocupação da semana" />
      <ul className="tn-sched-weekdays">
        {days.map((d) => {
          const list = ofDay(d);
          const plan = plans?.find((p) => p.date === d);
          const o = plan ? occupancy([plan], list) : null;
          const active = list.filter((b) => b.status === "confirmed" || b.status === "held" || b.status === "completed").length;
          return (
            <li key={d}>
              <button type="button" className="tn-sched-weekday" onClick={() => onPick(d)} aria-current={d === today ? "date" : undefined}>
                <span className="tn-sched-item__title">
                  {formatDayShort(d)}
                  {d === today ? " · hoje" : ""}
                </span>
                <span className="tn-sched-muted tn-num">
                  {plan && plan.open.length === 0
                    ? "Fechado"
                    : `${active} ${active === 1 ? "atendimento" : "atendimentos"}${o?.percent != null ? ` · ${o.percent}% ocupado` : ""}`}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
