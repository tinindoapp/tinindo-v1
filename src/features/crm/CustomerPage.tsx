// Ficha do cliente (auditoria de UX, item 35; P54, doc 07 §4.3 e doc 11 §3.6): o nome com "Agendar" como ação principal,
// o resumo de retorno, os próximos e os anteriores em linhas (cada um abre o atendimento na agenda) e o contato no fim.
// Somente leitura: editar e arquivar continuam na lista.
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import type { BookingStatus, CrmCustomer } from "@contracts";
import { LinkButton, PageHeader, Section, StatusBanner } from "../../components/ui/index.tsx";
import { ActionRow, type BadgeTone, CappedList, StatusBadge, Summary, SummaryHero, SummaryRows } from "../../components/ui/layout.tsx";
import { Icon } from "../../components/ui/icons.tsx";
import { type CustomerHistory, type HistoryItem, useCrmApi } from "./api.ts";
import { ContactButtons } from "./contact.tsx";
import { capitalize, useProfession } from "./CustomersPage.tsx";
import { formatPhone, SOURCE_LABEL } from "./format.ts";
import { PROFESSION_CONFIG } from "./profession.ts";
import { Tag } from "./shared.tsx";
import { serverMessage } from "../../lib/errors.ts";
import { formatCents } from "../../lib/money.ts";
import { formatDate, formatWeekdayDateTime } from "../../lib/time.ts";
import { agoText, daysSince } from "../../lib/visits.ts";

/** Estado do atendimento sempre por palavra. */
export const VISIT_STATUS: Record<BookingStatus, string> = {
  held: "Reserva provisória",
  confirmed: "Confirmado",
  completed: "Concluído",
  expired: "Reserva vencida",
  cancelled: "Cancelado",
  no_show: "Faltou",
};

/** Tom do selo (D15): concluído em verde, confirmado neutro, falta pede atenção. */
const VISIT_TONE: Record<BookingStatus, BadgeTone> = {
  held: "neutral",
  confirmed: "neutral",
  completed: "success",
  expired: "neutral",
  cancelled: "neutral",
  no_show: "warning",
};

type Load<T> = { status: "loading" } | { status: "ok"; value: T } | { status: "error"; message: string };

/** "5 concluídos · 1 faltou · 1 cancelado" (só os estados que aparecem). */
export function historySummary(items: readonly HistoryItem[]): string {
  const count = (s: BookingStatus) => items.filter((i) => i.status === s).length;
  const parts: string[] = [];
  const done = count("completed");
  const missed = count("no_show");
  const cancelled = count("cancelled");
  if (done) parts.push(`${done} ${done === 1 ? "concluído" : "concluídos"}`);
  if (missed) parts.push(`${missed} ${missed === 1 ? "falta" : "faltas"}`);
  if (cancelled) parts.push(`${cancelled} ${cancelled === 1 ? "cancelado" : "cancelados"}`);
  return parts.join(" · ");
}

export function CustomerPage() {
  const api = useCrmApi();
  const { customerId = "" } = useParams();
  const profession = useProfession();
  const noun = PROFESSION_CONFIG[profession ?? "other"].customer;
  const [customer, setCustomer] = useState<Load<CrmCustomer | null>>({ status: "loading" });
  const [history, setHistory] = useState<Load<CustomerHistory>>({ status: "loading" });

  useEffect(() => {
    let alive = true;
    api.getCustomer(customerId).then(
      (c) => alive && setCustomer({ status: "ok", value: c }),
      (e: unknown) => alive && setCustomer({ status: "error", message: serverMessage(e) }),
    );
    api.customerHistory(customerId).then(
      (h) => alive && setHistory({ status: "ok", value: h }),
      (e: unknown) => alive && setHistory({ status: "error", message: serverMessage(e) }),
    );
    return () => {
      alive = false;
    };
  }, [api, customerId]);

  const back = (
    <Link to="/app/clientes" className="tn-button crm-back" data-variant="ghost" data-size="compact">
      <Icon name="voltar" size={18} />
      {capitalize(noun.many)}
    </Link>
  );

  if (customer.status !== "ok" || !customer.value) {
    return (
      <div className="tn-stack">
        {back}
        <PageHeader id="crm-customer-title" title={customer.status === "loading" ? "Carregando…" : `${capitalize(noun.one)} não encontrado`} />
        {customer.status === "error" ? <StatusBanner tone="danger">{customer.message}</StatusBanner> : null}
        {customer.status === "ok" ? (
          <p className="tn-muted">Este cadastro não existe neste negócio. Volte para a lista e busque pelo nome.</p>
        ) : null}
      </div>
    );
  }

  const c = customer.value;
  const h = history.status === "ok" ? history.value : null;
  const now = h ? Date.parse(h.now) : 0;
  const upcoming = h ? h.items.filter((i) => Date.parse(i.starts_at) >= now).reverse() : [];
  const past = h ? h.items.filter((i) => Date.parse(i.starts_at) < now) : [];

  return (
    <div className="tn-stack">
      {back}
      <PageHeader
        id="crm-customer-title"
        eyebrow={`Ficha do ${noun.one}`}
        title={c.name}
        subtitle={c.archived_at ? <Tag>Arquivado</Tag> : undefined}
        actions={
          <>
            {/* O Novo agendamento pode ainda não ler `cliente`; o link já leva o cliente certo. */}
            <LinkButton to={`/app/agenda/novo?cliente=${encodeURIComponent(c.id)}`}>Agendar</LinkButton>
            <ContactButtons name={c.name} phone={c.phone} variant="ghost" />
          </>
        }
      />

      {history.status === "loading" ? <p role="status" className="tn-muted">Carregando o histórico…</p> : null}
      {history.status === "error" ? <StatusBanner tone="warning">Histórico ainda não disponível: {history.message}</StatusBanner> : null}
      {h ? <ReturnSummary history={h} past={past} upcoming={upcoming} /> : null}
      {h && h.items.length === 0 ? <p className="tn-muted">Nenhum atendimento ainda.</p> : null}
      {upcoming.length > 0 ? (
        <Section id="crm-history-next" title="Próximos" count={upcoming.length}>
          <div className="crm-visits">
            <ul className="tn-list" aria-label="Próximos atendimentos">
              {upcoming.map((v) => <VisitRow key={v.id} visit={v} timezone={h!.timezone} />)}
            </ul>
          </div>
        </Section>
      ) : null}
      {past.length > 0 ? (
        <Section id="crm-history-past" title="Anteriores" count={past.length}>
          <div className="crm-visits">
            <CappedList
              label="Atendimentos anteriores"
              items={past}
              render={(v) => <VisitRow key={v.id} visit={v} timezone={h!.timezone} />}
              truncated={!h!.complete}
              truncatedText={`Mostrando os ${h!.items.length} mais recentes; os mais antigos não aparecem aqui.`}
            />
          </div>
        </Section>
      ) : null}

      <Section id="crm-customer-contact" title="Contato">
        <dl className="crm-facts">
          <div>
            <dt>Telefone</dt>
            <dd className="tn-num">{c.phone ? formatPhone(c.phone) : "Não cadastrado"}</dd>
          </div>
          <div>
            <dt>E-mail</dt>
            <dd>{c.email ?? "Não cadastrado"}</dd>
          </div>
          <div>
            <dt>Como chegou</dt>
            <dd>{c.declared_source ? SOURCE_LABEL[c.declared_source] : "Não informado"}</dd>
          </div>
        </dl>
        {c.phone ? null : (
          <p className="tn-muted">Sem telefone cadastrado: para ligar ou chamar no WhatsApp daqui, cadastre o número na lista, em “⋯” › Editar.</p>
        )}
      </Section>
    </div>
  );
}

/** Resumo de retorno: a última visita concluída em destaque; concluídos, faltas e o próximo atendimento em linhas. */
function ReturnSummary({ history, past, upcoming }: { history: CustomerHistory; past: HistoryItem[]; upcoming: HistoryItem[] }) {
  const tz = history.timezone;
  const count = (s: BookingStatus) => past.filter((i) => i.status === s).length;
  const last = past.find((i) => i.status === "completed");
  const next = upcoming[0];
  const rows = [
    { key: "done", label: "Concluídos", value: count("completed") },
    { key: "missed", label: "Faltas", value: count("no_show") },
    ...(count("cancelled") ? [{ key: "cancelled", label: "Cancelados", value: count("cancelled") }] : []),
    next
      ? { key: "next", label: "Próximo atendimento", value: formatWeekdayDateTime(next.starts_at, tz), to: `/app/agenda/atendimento/${next.id}` }
      : { key: "next", label: "Próximo atendimento", value: "Nenhum marcado" },
  ];
  return (
    <Summary label="Resumo de retorno">
      {last ? (
        <SummaryHero
          id="crm-summary-hero"
          label="Última visita"
          value={agoText(daysSince(last.starts_at, new Date(history.now), tz))}
          hint={`${formatDate(last.starts_at, tz)} · ${last.service}`}
        />
      ) : (
        <SummaryHero id="crm-summary-hero" label="Última visita" value="Nenhuma" hint="Nenhum atendimento concluído na agenda." />
      )}
      <SummaryRows label="Atendimentos" rows={rows} />
    </Summary>
  );
}

/** Um atendimento em uma linha: quando, serviço, estado e valor; abre o atendimento na agenda. */
function VisitRow({ visit: v, timezone }: { visit: HistoryItem; timezone: string }) {
  return (
    <ActionRow
      to={v.id ? `/app/agenda/atendimento/${v.id}` : undefined}
      title={<span className="tn-num">{formatWeekdayDateTime(v.starts_at, timezone)}</span>}
      meta={
        <>
          {v.service}
          {v.price_cents !== null ? <span className="tn-num"> · {formatCents(v.price_cents)}</span> : null}
        </>
      }
      badge={<StatusBadge tone={VISIT_TONE[v.status]}>{VISIT_STATUS[v.status]}</StatusBadge>}
    />
  );
}
