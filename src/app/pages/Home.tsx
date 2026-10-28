// Hoje (doc 12): próximos atendimentos, pendências e até três ações úteis. Lê as mesmas portas da Agenda, do Caixa e das
// Metas (na demonstração, as mesmas instâncias: o que muda numa tela aparece aqui). Cada bloco falha sozinho; conta vazia
// mostra a lacuna e a próxima ação, nunca número inventado.
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import type { Booking } from "@contracts";
import { List, ListItem, PageHeader, Section, Stat, Stats, StatusBanner } from "../../components/ui/index.tsx";
import { Icon } from "../../components/ui/icons.tsx";
import { createApiClient } from "../../lib/api/client.ts";
import { getDemoPort as getFinanceDemoPort } from "../../features/finance/module.tsx";
import { formatCents, monthPeriod } from "../../features/finance/money.ts";
import type { FinancePort } from "../../features/finance/port.ts";
import { createServerPort as createFinanceServerPort } from "../../features/finance/serverPort.ts";
import { createDemoPort as createAdviceDemoPort } from "../../features/growth-advice/demoPort.ts";
import type { GrowthAdvicePort } from "../../features/growth-advice/port.ts";
import { createServerPort as createAdviceServerPort } from "../../features/growth-advice/serverPort.ts";
import { getDemoPort as getSchedulingDemoPort } from "../../features/scheduling/SchedulingLayout.tsx";
import type { SchedulingPort } from "../../features/scheduling/port.ts";
import { createServerPort as createSchedulingServerPort } from "../../features/scheduling/serverPort.ts";
import { dayWindow, formatDayLong, formatTime, localParts } from "../../features/scheduling/time.ts";
import { appEnv } from "../env.ts";
import { useSession } from "../session.tsx";

interface Ports {
  scheduling: SchedulingPort;
  finance: FinancePort;
  advice: GrowthAdvicePort;
}

interface Today {
  tenantName: string;
  timezone: string;
  dateLabel: string;
  agenda: { upcoming: (Booking & { serviceName: string; customerName: string | null })[]; confirmed: number; held: (Booking & { serviceName: string })[] } | null;
  money: { unchargedCount: number; unchargedCents: number; receivedCents: number } | null;
  advice: { count: number; first: string | null } | null;
}

const STATUS: Partial<Record<Booking["status"], string>> = { held: "Provisória", confirmed: "Confirmado", completed: "Concluído", no_show: "Faltou" };

async function loadToday(p: Ports): Promise<Today> {
  const ctx = await p.scheduling.context();
  const tz = ctx.timezone;
  const now = p.scheduling.now();
  const today = localParts(now, tz).date;
  const month = today.slice(0, 7);
  const [agenda, money, advice] = await Promise.allSettled([
    (async () => {
      const [bookings, services, customers] = await Promise.all([p.scheduling.listBookings(dayWindow(today, tz)), p.scheduling.listServices(), p.scheduling.listCustomers()]);
      const svc = new Map(services.map((s) => [s.id, s.name]));
      const cus = new Map(customers.map((c) => [c.id, c.name]));
      const live = bookings.filter((b) => b.status === "confirmed" || b.status === "held");
      const upcoming = live
        .filter((b) => Date.parse(b.ends_at) > now.getTime())
        .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
        .map((b) => ({ ...b, serviceName: svc.get(b.service_id) ?? "Atendimento", customerName: b.customer_id ? (cus.get(b.customer_id) ?? null) : null }));
      // Reservas provisórias, a que vence primeiro antes: cada pendência leva direto à reserva.
      const held = live
        .filter((b) => b.status === "held")
        .sort((a, b) => (a.hold_expires_at ?? a.starts_at).localeCompare(b.hold_expires_at ?? b.starts_at))
        .map((b) => ({ ...b, serviceName: svc.get(b.service_id) ?? "Atendimento" }));
      return { upcoming, confirmed: live.filter((b) => b.status === "confirmed").length, held };
    })(),
    (async () => {
      const period = monthPeriod(month, tz);
      const [uncharged, summary] = await Promise.all([p.finance.uncharged(period), p.finance.summary(period, tz)]);
      return { unchargedCount: uncharged.length, unchargedCents: uncharged.reduce((s, b) => s + (b.agreed_price_cents ?? 0), 0), receivedCents: summary.received_cents };
    })(),
    (async () => {
      const a = await p.advice.advice();
      return { count: a.suggestions.length, first: a.suggestions[0]?.title ?? null };
    })(),
  ]);
  return {
    tenantName: ctx.tenantName,
    timezone: tz,
    dateLabel: formatDayLong(today),
    agenda: agenda.status === "fulfilled" ? agenda.value : null,
    money: money.status === "fulfilled" ? money.value : null,
    advice: advice.status === "fulfilled" ? advice.value : null,
  };
}

export function Home() {
  const session = useSession();
  const { state, tenantId, getAccessToken } = session;
  const ports = useMemo<Ports | null>(() => {
    if (state.status === "offline_demo" || !appEnv.supabase) {
      return { scheduling: getSchedulingDemoPort(), finance: getFinanceDemoPort(), advice: createAdviceDemoPort() };
    }
    if (!tenantId) return null;
    const call = createApiClient({ baseUrl: appEnv.supabase.url, publishableKey: appEnv.supabase.publishableKey, getAccessToken });
    return { scheduling: createSchedulingServerPort(call, tenantId), finance: createFinanceServerPort(call, tenantId), advice: createAdviceServerPort(call, tenantId) };
  }, [state.status, tenantId, getAccessToken]);
  const [data, setData] = useState<{ ports: Ports; value?: Today; error?: unknown } | null>(null);

  useEffect(() => {
    if (!ports) return;
    let alive = true;
    loadToday(ports).then(
      (value) => alive && setData({ ports, value }),
      (error: unknown) => alive && setData({ ports, error: error ?? new Error("erro") }),
    );
    return () => {
      alive = false;
    };
  }, [ports]);

  const current = data && data.ports === ports ? data : null;
  const t = current?.value;
  const upcoming = t?.agenda?.upcoming ?? [];

  return (
    <div className="tn-today">
      <PageHeader eyebrow={t ? t.dateLabel : "Hoje"} title="Hoje" id="home-title" />
      {current?.error ? <StatusBanner tone="danger">Não foi possível carregar o resumo agora. As telas de Agenda e Caixa continuam disponíveis.</StatusBanner> : null}
      {!current && ports ? <p role="status" className="tn-today__loading">Carregando o seu dia…</p> : null}

      {t ? (
        <>
          <Stats label="Resumo">
            <Stat label="Atendimentos hoje" value={t.agenda ? t.agenda.confirmed : "—"} hint={t.agenda ? (t.agenda.held.length ? `+${t.agenda.held.length} provisória` : "confirmados") : "indisponível"} to="/app/agenda" />
            <Stat label="A cobrar" value={t.money ? t.money.unchargedCount : "—"} hint={t.money ? formatCents(t.money.unchargedCents) : "indisponível"} to="/app/caixa" />
            <Stat label="Recebido no mês" value={t.money ? formatCents(t.money.receivedCents) : "—"} hint="registrado" to="/app/caixa" />
          </Stats>

          <ul className="tn-quick" aria-label="Ações rápidas">
            <li><Link to="/app/agenda/novo" className="tn-quick__item" data-primary><span className="tn-quick__icon"><Icon name="mais" /></span>Novo agendamento</Link></li>
            <li><Link to="/app/caixa" className="tn-quick__item"><span className="tn-quick__icon"><Icon name="receber" /></span>Registrar recebimento</Link></li>
            <li><Link to="/app/assistente" className="tn-quick__item"><span className="tn-quick__icon"><Icon name="assistente" /></span>Perguntar ao assistente</Link></li>
          </ul>

          <Section title="Próximos atendimentos" id="home-next" action={<Link to="/app/agenda">Ver agenda</Link>}>
            {!t.agenda ? (
              <StatusBanner tone="warning">A agenda não respondeu agora.</StatusBanner>
            ) : upcoming.length === 0 ? (
              <p className="tn-today__empty">Nenhum atendimento até o fim do dia.</p>
            ) : (
              <List label="Próximos atendimentos">
                {upcoming.slice(0, 5).map((b) => (
                  <ListItem
                    key={b.id}
                    to={`/app/agenda/atendimento/${b.id}`}
                    title={<><span className="tn-num">{formatTime(b.starts_at, t.timezone)}</span> · {b.serviceName}</>}
                    meta={b.customerName ?? "Sem cliente vinculado"}
                    trailing={STATUS[b.status] ?? b.status}
                  />
                ))}
              </List>
            )}
            {upcoming.length > 5 ? <p className="tn-today__more">E mais {upcoming.length - 5} hoje.</p> : null}
          </Section>

          <Section title="Pendências" id="home-pending">
            {(() => {
              const rows = [
                t.money && t.money.unchargedCount > 0 ? <ListItem key="charge" to="/app/caixa" icon="receber" title={`${t.money.unchargedCount} atendimento(s) sem cobrança`} meta={`${formatCents(t.money.unchargedCents)} a registrar no Caixa`} /> : null,
                ...(t.agenda?.held ?? []).slice(0, 3).map((b) => (
                  <ListItem
                    key={`held-${b.id}`}
                    to={`/app/agenda/atendimento/${b.id}`}
                    icon="agenda"
                    title={<>Reserva provisória · <span className="tn-num">{formatTime(b.starts_at, t.timezone)}</span> {b.serviceName}</>}
                    meta={`${b.hold_expires_at ? `Vence às ${formatTime(b.hold_expires_at, t.timezone)}. ` : ""}Confirme ou libere o horário`}
                  />
                )),
                t.agenda && t.agenda.held.length > 3 ? <ListItem key="held-more" to="/app/agenda" icon="agenda" title={`Mais ${t.agenda.held.length - 3} reservas provisórias`} meta="Ver na agenda" /> : null,
                t.advice && t.advice.count > 0 ? <ListItem key="advice" to="/app/metas" icon="metas" title={`${t.advice.count} sugestão(ões) com base nos seus números`} meta={t.advice.first ?? undefined} /> : null,
              ].filter(Boolean);
              return rows.length ? <List label="Pendências">{rows}</List> : <p className="tn-today__empty">Nada pendente agora.</p>;
            })()}
          </Section>
        </>
      ) : null}
    </div>
  );
}
