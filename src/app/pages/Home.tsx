// Hoje (doc 12). Lê as mesmas portas da Agenda, do Caixa e das Metas (na demonstração, as mesmas instâncias: o que muda
// numa tela aparece aqui). Cada bloco falha sozinho; conta vazia mostra a lacuna e a próxima ação, nunca número inventado.
// P48 (decisão D6: o dia primeiro), nesta ordem:
//   1. cartão "Próximo", com "Atendido" e "Faltou" quando o horário já começou (as saídas de pagamento são as da Agenda);
//   2. a lista do dia; 3. pendências (sem cobrança, de qualquer mês, e reservas provisórias);
//   4. números (atendimentos de hoje e recebido na semana, com o mês na nota);
//   5. configuração: uma linha fina quando há atendimento no dia, o cartão inteiro quando não há;
//   6. uma sugestão do motor diário (P45), com "Ver todas".
// "Novo agendamento" é o botão "+" (flutuante no celular, como na Agenda); a grade "Ações rápidas" saiu.
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import type { Booking } from "@contracts";
import { List, ListItem, PageHeader, Section, Stat, Stats, StatusBanner } from "../../components/ui/index.tsx";
import { Icon } from "../../components/ui/icons.tsx";
import { createApiClient } from "../../lib/api/client.ts";
import { getDemoPort as getFinanceDemoPort } from "../../features/finance/module.tsx";
import { formatCents, pendingPeriod } from "../../features/finance/money.ts";
import type { FinancePort } from "../../features/finance/port.ts";
import { createServerPort as createFinanceServerPort } from "../../features/finance/serverPort.ts";
import { createDemoPort as createAdviceDemoPort } from "../../features/growth-advice/demoPort.ts";
import type { GrowthAdvicePort } from "../../features/growth-advice/port.ts";
import { createServerPort as createAdviceServerPort } from "../../features/growth-advice/serverPort.ts";
import { InsightsCard } from "../../features/growth-advice/Insights.tsx";
import { getDemoPort as getSchedulingDemoPort, SchedulingPortProvider } from "../../features/scheduling/SchedulingLayout.tsx";
import { AttendanceActions } from "../../features/scheduling/attendance.tsx";
import type { SchedulingPort } from "../../features/scheduling/port.ts";
import { createServerPort as createSchedulingServerPort } from "../../features/scheduling/serverPort.ts";
import { SetupCard, useSetupPort } from "../../features/setup/module.tsx";
import { canComplete, formatCents as formatSchedulingCents, formatMinutes, whatsAppDigits } from "../../features/scheduling/agenda.ts";
import { ListStatusBadge } from "../../features/scheduling/parts.tsx";
import { dayWindow, formatDayLong, formatTime, localParts } from "../../features/scheduling/time.ts";
import { appEnv } from "../env.ts";
import { useSession } from "../session.tsx";
import { plural } from "../../lib/text/plural.ts";
import { receivedPeriods } from "../../lib/time.ts";

interface Ports {
  scheduling: SchedulingPort;
  finance: FinancePort;
  advice: GrowthAdvicePort;
}

/** Atendimento de hoje como a tela mostra: nomes já resolvidos e se o horário já passou. */
type DayItem = Booking & { serviceName: string; customerName: string | null; phone: string | null; past: boolean };

interface Today {
  tenantName: string;
  timezone: string;
  dateLabel: string;
  now: number;
  agenda: { day: DayItem[]; next: DayItem | null; confirmed: number; held: (Booking & { serviceName: string })[] } | null;
  money: { unchargedCount: number; unchargedCents: number; weekCents: number; monthCents: number } | null;
}

/** Quantos itens do dia a lista mostra; o resto fica em "Ver os N de hoje". */
const DAY_LIMIT = 6;

/** "agora" (já começou), "em 20 min", "em 1 h 5 min". */
function startsIn(startsAt: string, now: number): string {
  const min = Math.ceil((Date.parse(startsAt) - now) / 60_000);
  return min <= 0 ? "agora" : `em ${formatMinutes(min)}`;
}

/** Janela da lista do dia: com mais de DAY_LIMIT itens, começa um antes do próximo (o que acabou de passar). */
function dayWindowAround(day: DayItem[], next: DayItem | null): DayItem[] {
  if (day.length <= DAY_LIMIT) return day;
  const at = next ? day.indexOf(next) : day.length;
  const start = Math.max(0, Math.min(at - 1, day.length - DAY_LIMIT));
  return day.slice(start, start + DAY_LIMIT);
}

async function loadToday(p: Ports): Promise<Today> {
  const ctx = await p.scheduling.context();
  const tz = ctx.timezone;
  const now = p.scheduling.now();
  const today = localParts(now, tz).date;
  const [agenda, money] = await Promise.allSettled([
    (async () => {
      const [bookings, services, customers] = await Promise.all([p.scheduling.listBookings(dayWindow(today, tz)), p.scheduling.listServices(), p.scheduling.listCustomers()]);
      const svc = new Map(services.map((s) => [s.id, s.name]));
      const cus = new Map(customers.map((c) => [c.id, c]));
      const live = bookings.filter((b) => b.status === "confirmed" || b.status === "held");
      // O dia inteiro (sem as reservas vencidas), em ordem; o que já terminou fica em cinza.
      const day: DayItem[] = bookings
        .filter((b) => b.status !== "expired")
        .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))
        .map((b) => {
          const c = b.customer_id ? cus.get(b.customer_id) : undefined;
          return { ...b, serviceName: svc.get(b.service_id) ?? "Atendimento", customerName: c?.name ?? null, phone: c?.phone ?? null, past: Date.parse(b.ends_at) <= now.getTime() };
        });
      // Próximo: o primeiro confirmado ou provisório que ainda não terminou (o que está acontecendo conta como "agora").
      const next = day.find((b) => (b.status === "confirmed" || b.status === "held") && !b.past) ?? null;
      // Reservas provisórias, a que vence primeiro antes: cada pendência leva direto à reserva.
      const held = live
        .filter((b) => b.status === "held")
        .sort((a, b) => (a.hold_expires_at ?? a.starts_at).localeCompare(b.hold_expires_at ?? b.starts_at))
        .map((b) => ({ ...b, serviceName: svc.get(b.service_id) ?? "Atendimento" }));
      return { day, next, confirmed: live.filter((b) => b.status === "confirmed").length, held };
    })(),
    (async () => {
      // "Sem cobrança" é o que está em aberto até hoje, de qualquer mês; o recebido é da semana (de segunda a hoje) e do
      // mês corrente, duas chamadas a `finance.summary` com períodos diferentes (o contrato não muda).
      const periods = receivedPeriods(today, tz);
      const [uncharged, week, month] = await Promise.all([
        p.finance.uncharged(pendingPeriod(today, tz)), p.finance.summary(periods.week, tz), p.finance.summary(periods.month, tz),
      ]);
      return {
        unchargedCount: uncharged.length,
        unchargedCents: uncharged.reduce((s, b) => s + (b.agreed_price_cents ?? 0), 0),
        weekCents: week.received_cents,
        monthCents: month.received_cents,
      };
    })(),
  ]);
  return {
    tenantName: ctx.tenantName,
    timezone: tz,
    dateLabel: formatDayLong(today),
    now: now.getTime(),
    agenda: agenda.status === "fulfilled" ? agenda.value : null,
    money: money.status === "fulfilled" ? money.value : null,
  };
}

export function Home() {
  const session = useSession();
  const { state, tenantId, getAccessToken } = session;
  // P44: "Deixe seu negócio pronto · N de 8", a mesma porta da tela Configuração. Some quando tudo está resolvido.
  const setupPort = useSetupPort();
  const ports = useMemo<Ports | null>(() => {
    if (state.status === "offline_demo" || !appEnv.supabase) {
      return { scheduling: getSchedulingDemoPort(), finance: getFinanceDemoPort(), advice: createAdviceDemoPort() };
    }
    if (!tenantId) return null;
    const call = createApiClient({ baseUrl: appEnv.supabase.url, publishableKey: appEnv.supabase.publishableKey, getAccessToken });
    return { scheduling: createSchedulingServerPort(call, tenantId), finance: createFinanceServerPort(call, tenantId), advice: createAdviceServerPort(call, tenantId) };
  }, [state.status, tenantId, getAccessToken]);
  const [data, setData] = useState<{ ports: Ports; value?: Today; error?: unknown } | null>(null);
  // Depois de "Atendido" ou "Faltou" no cartão "Próximo", o dia é relido com o dado anterior na tela (nada pisca).
  const [nonce, setNonce] = useState(0);

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
  }, [ports, nonce]);

  const current = data && data.ports === ports ? data : null;
  const t = current?.value;
  const day = t?.agenda?.day ?? [];
  const next = t?.agenda?.next ?? null;
  const shown = dayWindowAround(day, next).filter((b) => b !== next);
  const held = t?.agenda?.held ?? [];
  const reload = () => setNonce((n) => n + 1);

  const pendingRows = t
    ? [
        t.money && t.money.unchargedCount > 0 ? (
          <ListItem key="charge" to="/app/caixa" icon="receber" title={`${plural(t.money.unchargedCount, "atendimento")} sem cobrança`}
            meta={<><span className="tn-num">{formatCents(t.money.unchargedCents)}</span> a registrar no Caixa</>} />
        ) : null,
        ...held.slice(0, 3).map((b) => (
          <ListItem
            key={`held-${b.id}`}
            to={`/app/agenda/atendimento/${b.id}`}
            icon="agenda"
            title={<>Reserva provisória · <span className="tn-num">{formatTime(b.starts_at, t.timezone)}</span> {b.serviceName}</>}
            meta={`${b.hold_expires_at ? `Vence às ${formatTime(b.hold_expires_at, t.timezone)}. ` : ""}Confirme ou libere o horário`}
          />
        )),
        held.length > 3 ? <ListItem key="held-more" to="/app/agenda" icon="agenda" title={`Mais ${held.length - 3} reservas provisórias`} meta="Ver na agenda" /> : null,
      ].filter(Boolean)
    : [];

  return (
    <div className="tn-today">
      <PageHeader eyebrow={t ? t.dateLabel : "Hoje"} title="Hoje" id="home-title" />
      {current?.error ? <StatusBanner tone="danger">Não foi possível carregar o resumo agora. As telas de Agenda e Caixa continuam disponíveis.</StatusBanner> : null}
      {!current && ports ? <p role="status" className="tn-today__loading">Carregando o seu dia…</p> : null}

      {t && ports ? (
        <>
          {/* 1. Próximo: quem é, quando, e as ações do atendimento quando o horário já começou. */}
          {next ? (
            <SchedulingPortProvider port={ports.scheduling} collect={ports.finance}>
              <NextCard item={next} timezone={t.timezone} now={t.now} onChanged={reload} />
            </SchedulingPortProvider>
          ) : null}

          {/* 2. O dia. */}
          <Section title="Atendimentos de hoje" id="home-day">
            {!t.agenda ? (
              <StatusBanner tone="warning">A agenda não respondeu agora.</StatusBanner>
            ) : day.length === 0 ? (
              <p className="tn-today__empty">Nenhum atendimento hoje.</p>
            ) : (
              <>
                {!next ? <p className="tn-today__empty">Nenhum atendimento até o fim do dia.</p> : null}
                {shown.length ? (
                  <List label="Outros atendimentos de hoje">
                    {shown.map((b) => (
                      <li key={b.id} className="tn-today__row" data-past={b.past ? "true" : undefined}>
                        <Link to={`/app/agenda/atendimento/${b.id}`} className="tn-list__row">
                          <span className="tn-list__text">
                            <span className="tn-list__title">
                              <span className="tn-num">{formatTime(b.starts_at, t.timezone)}</span> · {b.serviceName}
                            </span>
                            <span className="tn-list__meta">
                              {b.customerName ?? "Sem cliente vinculado"}
                              {b.past ? <span className="tn-visually-hidden"> · já passou</span> : null}
                            </span>
                          </span>
                          <span className="tn-list__trailing"><ListStatusBadge status={b.status} /></span>
                          <Icon name="seta" size={18} className="tn-list__chevron" />
                        </Link>
                      </li>
                    ))}
                  </List>
                ) : null}
                <p className="tn-today__more">
                  <Link to="/app/agenda">{day.length === 1 ? "Ver o atendimento de hoje na agenda" : `Ver os ${day.length} de hoje`}</Link>
                </p>
              </>
            )}
          </Section>

          {/* 3. Pendências. */}
          <Section title="Pendências" id="home-pending">
            {pendingRows.length ? <List label="Pendências">{pendingRows}</List> : <p className="tn-today__empty">Nada pendente agora.</p>}
          </Section>

          {/* 4. Números: o dia e o dinheiro da semana (o mês vai na nota). */}
          <Stats label="Resumo">
            <Stat label="Atendimentos hoje" value={t.agenda ? t.agenda.confirmed : "—"}
              hint={t.agenda ? (held.length ? `+${held.length} provisória` : "confirmados") : "indisponível"} to="/app/agenda" />
            <Stat label="Recebido na semana" value={t.money ? formatCents(t.money.weekCents) : "—"}
              hint={t.money ? <>no mês: <span className="tn-num">{formatCents(t.money.monthCents)}</span></> : "indisponível"} to="/app/caixa" />
          </Stats>

          {/* 5. Configuração: uma linha quando há atendimento no dia; o cartão inteiro quando o dia está vazio. */}
          {setupPort ? <SetupCard port={setupPort} compact={day.length > 0} /> : null}
          {/* 6. Uma sugestão do motor diário (P45), com "Ver todas". */}
          <InsightsCard port={ports.advice} limit={1} />
        </>
      ) : null}

      {/* "+" Novo agendamento: flutuante no celular (acima das abas), no fim da tela no largo. */}
      <Link className="tn-button tn-today__new" data-variant="primary" to="/app/agenda/novo">
        <Icon name="mais" size={20} />
        <span className="tn-today__new-label">Novo agendamento</span>
      </Link>
    </div>
  );
}

/** Destaque do próximo atendimento: hora, cliente e quanto falta, com "Abrir" e "WhatsApp" (auditoria de UX, item 31). */
function NextCard({ item, timezone, now, onChanged }: { item: DayItem; timezone: string; now: number; onChanged: () => void }) {
  const digits = whatsAppDigits(item.phone);
  const who = item.customerName ?? "Sem cliente vinculado";
  // Já começou: "Atendido" (com as saídas de pagamento) e "Faltou", as mesmas do cartão da Agenda.
  const started = canComplete(item, new Date(now));
  return (
    <section className="tn-today__next" aria-labelledby="home-next-title">
      <h2 id="home-next-title" className="tn-today__next-title">
        Próximo: <span className="tn-num">{formatTime(item.starts_at, timezone)}</span> · {who} · {startsIn(item.starts_at, now)}
      </h2>
      <p className="tn-today__next-meta">
        {item.serviceName}
        {item.agreed_price_cents !== null ? <> · <span className="tn-num">{formatSchedulingCents(item.agreed_price_cents)}</span></> : null}
        {" "}<ListStatusBadge status={item.status} />
      </p>
      {started ? <AttendanceActions booking={item} when={`às ${formatTime(item.starts_at, timezone)}`} onChanged={onChanged} /> : null}
      <div className="tn-actions">
        {/* Um botão principal por tela: com as ações do atendimento à vista, "Abrir" passa a secundário. */}
        <Link className="tn-button" data-variant={started ? "secondary" : "primary"} to={`/app/agenda/atendimento/${item.id}`}>
          Abrir<span className="tn-visually-hidden"> o atendimento das {formatTime(item.starts_at, timezone)}</span>
        </Link>
        {digits ? (
          <a className="tn-button" data-variant={started ? "ghost" : "secondary"} href={`https://wa.me/${digits}`} target="_blank" rel="noreferrer noopener">
            WhatsApp<span className="tn-visually-hidden"> de {who}</span>
          </a>
        ) : null}
      </div>
    </section>
  );
}
