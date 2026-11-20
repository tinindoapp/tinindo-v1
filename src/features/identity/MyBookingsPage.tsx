// Minhas reservas (/app/conta/reservas): o cliente com login vê as próprias reservas em cada negócio em que tem vínculo
// comprovado. Só leitura: remarcar ou cancelar continua sendo com o profissional. Horários no fuso de cada negócio.
import { useEffect, useState } from "react";
import { Link } from "react-router";
import type { MyBooking } from "@contracts";
import { Card, List, ListItem, PageHeader, Section, StatusBanner } from "../../components/ui/index.tsx";
import { formatCents } from "../../lib/money.ts";
import { formatTime, formatWeekdayDate } from "../../lib/time.ts";
import { messageFor } from "./errors.ts";
import { useIdentityServices } from "./services.tsx";

const STATUS: Record<MyBooking["status"], string> = {
  held: "Aguardando confirmação",
  confirmed: "Confirmada",
  completed: "Concluída",
  cancelled: "Cancelada",
  no_show: "Falta registrada",
};
/** Mesmo prazo de avaliação do banco (P24). */
const REVIEW_WINDOW_MS = 30 * 86_400_000;
/** "ter., 20/10, 09:00–09:30" no fuso do negócio da reserva. */
function when(b: MyBooking): string {
  return `${formatWeekdayDate(b.starts_at, b.timezone)}, ${formatTime(b.starts_at, b.timezone)}–${formatTime(b.ends_at, b.timezone)}`;
}

type Load = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; now: number; bookings: MyBooking[] };

function Item({ b, now }: { b: MyBooking; now: number }) {
  const reviewable = b.status === "completed" && now - Date.parse(b.ends_at) <= REVIEW_WINDOW_MS;
  const price = b.agreed_price_cents === null ? null : formatCents(b.agreed_price_cents);
  return (
    <ListItem
      title={`${b.service_name} · ${b.tenant_name}`}
      meta={
        <>
          <span className="tn-num">{when(b)}</span> · {STATUS[b.status]}
          {price ? <> · <span className="tn-num">{price}</span></> : null}
        </>
      }
      trailing={reviewable ? <Link to={`/avaliar?atendimento=${b.booking_id}`}>Avaliar</Link> : undefined}
    />
  );
}

export function MyBookingsPage() {
  const services = useIdentityServices();
  const [state, setState] = useState<Load>({ kind: "loading" });

  useEffect(() => {
    let alive = true;
    services.loadMyBookings().then(
      (r) => alive && setState({ kind: "ready", now: Date.parse(r.now), bookings: r.bookings }),
      (e: unknown) => alive && setState({ kind: "error", message: messageFor(e, "link") }),
    );
    return () => {
      alive = false;
    };
  }, [services]);

  const upcoming = state.kind === "ready"
    ? state.bookings.filter((b) => (b.status === "confirmed" || b.status === "held") && Date.parse(b.ends_at) > state.now)
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
    : [];
  const past = state.kind === "ready" ? state.bookings.filter((b) => !upcoming.includes(b)) : [];

  return (
    <div className="tn-stack">
      <p>
        <Link to="/app/conta">Voltar para a conta</Link>
      </p>
      <PageHeader title="Minhas reservas" subtitle="Seus horários nos profissionais em que você é cliente. Cada profissional vê só o que é dele." />
      {!services.online ? (
        <StatusBanner tone="info">
          <strong>Demonstração.</strong> Você vê como a Cliente Exemplo Ana: as reservas dela na Agenda desta aba.
        </StatusBanner>
      ) : null}
      {state.kind === "loading" ? <p role="status">Carregando…</p> : null}
      {state.kind === "error" ? <StatusBanner tone="danger">{state.message}</StatusBanner> : null}
      {state.kind === "ready" && state.bookings.length === 0 ? (
        <Card>
          <p>Nenhuma reserva por aqui ainda. Elas aparecem quando um profissional liga o cadastro dele à sua conta.</p>
          <p>
            <Link to="/app/conta/vincular">Tenho um código de vínculo</Link>
          </p>
        </Card>
      ) : null}
      {upcoming.length > 0 ? (
        <Section id="minhas-proximas" title="Próximas">
          <List label="Próximas reservas">{upcoming.map((b) => <Item key={b.booking_id} b={b} now={state.kind === "ready" ? state.now : 0} />)}</List>
        </Section>
      ) : null}
      {past.length > 0 ? (
        <Section id="minhas-anteriores" title="Anteriores e canceladas">
          <List label="Reservas anteriores">{past.map((b) => <Item key={b.booking_id} b={b} now={state.kind === "ready" ? state.now : 0} />)}</List>
        </Section>
      ) : null}
      {state.kind === "ready" && state.bookings.length > 0 ? (
        <p className="tn-muted">Para remarcar ou cancelar, fale com o profissional. Esta lista não altera nenhuma reserva.</p>
      ) : null}
    </div>
  );
}
