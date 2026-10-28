// Ficha do cliente (auditoria de UX, item 35): contato, ligar e WhatsApp, e o histórico de atendimentos lido da agenda.
// Somente leitura: editar e arquivar continuam na lista.
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import type { BookingStatus, CrmCustomer } from "@contracts";
import { Card, PageHeader, StatusBanner } from "../../components/ui/index.tsx";
import { Icon } from "../../components/ui/icons.tsx";
import { type CustomerHistory, errorMessage, type HistoryItem, useCrmApi } from "./api.ts";
import { ContactButtons } from "./contact.tsx";
import { capitalize, useProfession } from "./CustomersPage.tsx";
import { formatCents, formatPhone, SOURCE_LABEL } from "./format.ts";
import { PROFESSION_CONFIG } from "./profession.ts";
import { CrmDemoNotice, Tag } from "./shared.tsx";

/** Estado do atendimento sempre por palavra. */
export const VISIT_STATUS: Record<BookingStatus, string> = {
  held: "Reserva provisória",
  confirmed: "Confirmado",
  completed: "Concluído",
  expired: "Reserva vencida",
  cancelled: "Cancelado",
  no_show: "Faltou",
};

type Load<T> = { status: "loading" } | { status: "ok"; value: T } | { status: "error"; message: string };

const dateTime = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone, weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
const dateOnly = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone, day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(iso));

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
      (e: unknown) => alive && setCustomer({ status: "error", message: errorMessage(e) }),
    );
    api.customerHistory(customerId).then(
      (h) => alive && setHistory({ status: "ok", value: h }),
      (e: unknown) => alive && setHistory({ status: "error", message: errorMessage(e) }),
    );
    return () => {
      alive = false;
    };
  }, [api, customerId]);

  const back = (
    <Link to="/app/clientes" className="tn-button crm-back" data-variant="ghost">
      <Icon name="voltar" size={20} />
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
  const nowIso = history.status === "ok" ? history.value.now : "";
  const upcoming = history.status === "ok" ? history.value.items.filter((i) => Date.parse(i.starts_at) >= Date.parse(nowIso)).reverse() : [];
  const past = history.status === "ok" ? history.value.items.filter((i) => Date.parse(i.starts_at) < Date.parse(nowIso)) : [];

  return (
    <div className="tn-stack">
      {back}
      <PageHeader
        id="crm-customer-title"
        eyebrow={`Ficha do ${noun.one}`}
        title={c.name}
        subtitle={c.archived_at ? <Tag>Arquivado</Tag> : undefined}
      />
      <CrmDemoNotice />

      <Card aria-labelledby="crm-customer-contact">
        <div className="tn-stack" data-gap="sm">
          <h2 id="crm-customer-contact">Contato</h2>
          <dl className="crm-facts">
            <div>
              <dt>Telefone</dt>
              <dd>{c.phone ? formatPhone(c.phone) : "Não cadastrado"}</dd>
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
          {c.phone ? (
            <div className="tn-actions">
              <ContactButtons name={c.name} phone={c.phone} />
            </div>
          ) : (
            <p className="tn-muted">Sem telefone cadastrado: para ligar ou chamar no WhatsApp daqui, cadastre o número na lista, em “⋯” › Editar.</p>
          )}
        </div>
      </Card>

      <Card aria-labelledby="crm-customer-history">
        <div className="tn-stack" data-gap="sm">
          <h2 id="crm-customer-history">Atendimentos</h2>
          {history.status === "loading" ? <p role="status" className="tn-muted">Carregando o histórico…</p> : null}
          {history.status === "error" ? (
            <StatusBanner tone="warning">Histórico ainda não disponível: {history.message}</StatusBanner>
          ) : null}
          {history.status === "ok" ? (
            <>
              <p className="tn-muted">
                De {dateOnly(history.value.from, history.value.timezone)} a {dateOnly(history.value.until, history.value.timezone)}.
                {historySummary(past) ? ` Até agora: ${historySummary(past)}.` : ""} Atendimentos mais antigos ainda não aparecem aqui.
              </p>
              {history.value.items.length === 0 ? <p>Nenhum atendimento neste período.</p> : null}
              {upcoming.length > 0 ? <VisitList title="Próximos" id="crm-history-next" items={upcoming} timezone={history.value.timezone} /> : null}
              {past.length > 0 ? <VisitList title="Anteriores" id="crm-history-past" items={past} timezone={history.value.timezone} /> : null}
            </>
          ) : null}
        </div>
      </Card>
    </div>
  );
}

function VisitList({ title, id, items, timezone }: { title: string; id: string; items: HistoryItem[]; timezone: string }) {
  return (
    <section aria-labelledby={id} className="tn-stack" data-gap="sm">
      <h3 id={id}>
        {title} ({items.length})
      </h3>
      <ul className="tn-item-list">
        {items.map((v) => (
          <li key={v.id} className="crm-visit">
            <span className="crm-visit__when">{dateTime(v.starts_at, timezone)}</span>
            <span>{v.service}</span>
            <span className="crm-visit__meta">
              {VISIT_STATUS[v.status]}
              {v.price_cents !== null ? ` · ${formatCents(v.price_cents)}` : ""}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
