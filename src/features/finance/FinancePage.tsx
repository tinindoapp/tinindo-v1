// Caixa registrado (P07): o que entrou, o que saiu e o que falta receber, com período e cobertura.
// Separações que a tela nunca mistura: atendimento concluído ≠ cobrado ≠ recebido; crédito de pacote ≠ caixa.
// Ordem (P54; doc 07 §4.2, doc 11 §3.3): abertura com o mês e "Registrar" → resumo ("Sobrou no mês" e as linhas) →
// atendimentos sem cobrança → A receber → histórico (Recebimentos, Despesas, Pacotes, uma lista por vez).
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import type { PackageDetail, TimeRange, UnchargedBooking } from "@contracts";
import { Button, Help, IconButton, PageHeader, StatusBanner, Summary, SummaryHero, type SummaryRowData, SummaryRows, toast } from "../../components/ui/index.tsx";
import { Icon } from "../../components/ui/icons.tsx";
import { receivedPeriods } from "../../lib/time.ts";
import { capitalizeFirst, formatCents, formatDate, formatMonth, leftover, localDate, monthPeriod, newestFirst, pendingPeriod, shiftMonth } from "./money.ts";
import { type RegisterKind, RegisterPanel } from "./forms.tsx";
import { History } from "./sections/History.tsx";
import { Receivables, Uncharged } from "./sections/Pending.tsx";
import { type Ctx, explain, PageContext, usePage, usePort } from "./shared.tsx";
import type { FinanceBase, FinancePort } from "./port.ts";

export { FinancePortProvider } from "./shared.tsx";

interface MonthData {
  summary: Awaited<ReturnType<FinancePort["summary"]>>;
  ledger: Awaited<ReturnType<FinancePort["ledger"]>>;
  uncharged: UnchargedBooking[];
  packages: PackageDetail[];
}

export function FinancePage() {
  const port = usePort();
  const [params, setParams] = useSearchParams();
  const [base, setBase] = useState<FinanceBase | null>(null);
  const [data, setData] = useState<{ month: string; nonce: number; value?: MonthData; error?: unknown } | null>(null);
  const [nonce, setNonce] = useState(0);
  const [baseError, setBaseError] = useState<unknown>(null);
  // "+ Registrar" (item 56): os formulários ficam fechados e abrem num painel no lugar, com foco no primeiro campo.
  const [register, setRegister] = useState<RegisterKind | null>(null);

  useEffect(() => {
    let alive = true;
    port.base().then((b) => alive && setBase(b), (e: unknown) => alive && setBaseError(e ?? new Error("erro")));
    return () => {
      alive = false;
    };
  }, [port]);

  const tz = base?.timezone ?? "America/Sao_Paulo";
  const today = localDate(port.now(), tz);
  const currentMonth = today.slice(0, 7);
  const qMonth = params.get("mes");
  const month = qMonth && /^\d{4}-(0[1-9]|1[0-2])$/.test(qMonth) ? qMonth : currentMonth;
  const period: TimeRange = monthPeriod(month, tz);
  // Pendência não tem mês: o atendimento concluído sem cobrança aparece até ser cobrado, seja qual for o mês escolhido.
  // O seletor vale para o caixa registrado, os recebimentos e as despesas.
  const pending: TimeRange = pendingPeriod(today, tz);
  const focusBooking = params.get("atendimento");

  useEffect(() => {
    if (!base) return;
    let alive = true;
    Promise.all([port.summary(period, base.timezone), port.ledger(period), port.uncharged(pending), port.packages()]).then(
      ([summary, ledger, uncharged, packages]) =>
        alive && setData({ month, nonce, value: { summary, ledger, uncharged: newestFirst(uncharged), packages } }),
      (error: unknown) => alive && setData({ month, nonce, error: error ?? new Error("erro") }),
    );
    return () => {
      alive = false;
    };
    // period deriva de month + base.timezone; pending, de today + base.timezone
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [port, base, month, today, nonce]);

  const go = (m: string) => {
    const p = new URLSearchParams(params);
    p.set("mes", m);
    setParams(p);
  };

  if (baseError) {
    return (
      <Shell>
        <StatusBanner tone="danger">{explain(baseError)}</StatusBanner>
      </Shell>
    );
  }
  if (!base) {
    return (
      <Shell>
        <p role="status">Carregando o caixa…</p>
      </Shell>
    );
  }

  const ctx: Ctx = {
    base,
    today,
    reload: () => setNonce((n) => n + 1),
    // Confirmação e erro de ação de um toque saem num aviso curto (Toast), sempre à vista.
    notify: (tone, text) => toast({ message: text, tone }),
    customerName: (id) => base.customers.find((c) => c.id === id)?.name ?? (id ? "Cliente" : "Sem cliente cadastrado"),
    serviceName: (id) => base.services.find((s) => s.id === id)?.name ?? "Serviço",
    focusBooking,
  };
  // Depois de uma ação, o mês é relido (nonce) com o dado anterior na tela: as seções não desmontam, então o foco,
  // "Ver todos" e formulários abertos continuam. "Carregando o mês…" só aparece na troca de mês.
  const current = data && data.month === month ? data : null;
  const registerButton = (
    <Button aria-expanded={register !== null} aria-controls="fin-register" onClick={() => setRegister(register ? null : "receipt")}>
      <Icon name="mais" size={20} />
      Registrar
    </Button>
  );
  const monthPicker = (
    <div className="tn-fin-period" role="group" aria-label="Período">
      {/* Não há ícone de seta para a esquerda: a mesma seta, espelhada. */}
      <IconButton icon="voltar" label="Mês anterior" variant="secondary" onClick={() => go(shiftMonth(month, -1))} />
      <strong className="tn-fin-period__label">{capitalizeFirst(formatMonth(month))}</strong>
      <IconButton icon="seta" label="Próximo mês" variant="secondary" onClick={() => go(shiftMonth(month, 1))} disabled={month >= currentMonth} />
    </div>
  );

  return (
    <PageContext.Provider value={ctx}>
      <Shell actions={registerButton} filter={monthPicker}>
        {register ? <RegisterPanel kind={register} onKind={setRegister} onClose={() => setRegister(null)} /> : null}
        {current?.error ? (
          <StatusBanner tone="danger">{explain(current.error)}</StatusBanner>
        ) : !current?.value ? (
          <p role="status">Carregando o mês…</p>
        ) : (
          <>
            <MonthSummary s={current.value.summary} month={month} current={month === currentMonth} nonce={nonce} />
            <Uncharged list={current.value.uncharged} packages={current.value.packages} />
            <Receivables list={current.value.ledger.receivables.filter((r) => r.status === "open" || r.status === "partially_paid")}
              truncated={current.value.ledger.truncated?.receivables} />
            <History payments={current.value.ledger.payments} expenses={current.value.ledger.expenses} packages={current.value.packages}
              truncated={current.value.ledger.truncated} />
            <FocusBooking id={focusBooking} value={current.value} />
          </>
        )}
      </Shell>
    </PageContext.Provider>
  );
}

function Shell({ actions, filter, children }: { actions?: ReactNode; filter?: ReactNode; children: ReactNode }) {
  // D11 (b): a faixa "Demonstração" do topo já identifica a demonstração; a tela não repete o aviso.
  return (
    <section aria-labelledby="fin-title" className="tn-fin">
      <PageHeader id="fin-title" title="Caixa" actions={actions} filter={filter} />
      {children}
    </section>
  );
}

/**
 * Hoje e Semana (P48): o recebido nos períodos correntes, sempre a partir de hoje. Duas chamadas a `finance.summary`;
 * o contrato não muda. O mês corrente vem do resumo do mês (não repete o valor).
 */
function useReceivedNow(today: string, nonce: number, enabled: boolean) {
  const port = usePort();
  const { base } = usePage();
  const tz = base.timezone;
  const [data, setData] = useState<{ value?: [number, number]; failed?: boolean } | null>(null);
  const key = `${today}#${nonce}`;
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const p = receivedPeriods(today, tz);
    Promise.all([port.summary(p.day, tz), port.summary(p.week, tz)]).then(
      ([d, w]) => alive && setData({ value: [d.received_cents, w.received_cents] }),
      () => alive && setData((old) => ({ ...old, failed: true })),
    );
    return () => {
      alive = false;
    };
  }, [port, today, tz, key, enabled]);
  // Depois de uma ação, o valor anterior fica até chegar o novo (a linha não pisca).
  return data;
}

function MonthSummary({ s, month, current, nonce }: { s: MonthData["summary"]; month: string; current: boolean; nonce: number }) {
  const { today, base } = usePage();
  const now = useReceivedNow(today, nonce, current);
  const left = leftover(s.received_cents, s.spent_cents);
  const ddmm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
  const week = receivedPeriods(today, base.timezone).weekFrom;
  const v = now?.value;
  const nowValue = (i: 0 | 1) => (v ? formatCents(v[i]) : now?.failed ? "—" : "…");
  const rows: SummaryRowData[] = [
    ...(current
      ? [
          { key: "day", label: <>Recebido hoje <span className="tn-num">{ddmm(today)}</span></>, value: nowValue(0) },
          { key: "week", label: <>Recebido na semana <span className="tn-num">{week === today ? ddmm(today) : `${ddmm(week)} a ${ddmm(today)}`}</span></>, value: nowValue(1) },
        ]
      : []),
    { key: "received", label: "Recebido no mês", value: formatCents(s.received_cents) },
    { key: "spent", label: "Gasto no mês", value: formatCents(s.spent_cents) },
    { key: "open", label: "A receber (hoje)", value: formatCents(s.receivable_open_cents) },
  ];
  return (
    <section aria-labelledby="fin-sum-title" className="tn-fin-summary">
      <h2 id="fin-sum-title" className="tn-visually-hidden">Caixa registrado em {formatMonth(month)}</h2>
      <Summary label={`Resumo de ${formatMonth(month)}`}>
        <SummaryHero id="fin-left-label" label={left.label} value={<span data-testid="fin-left">{formatCents(Math.abs(left.cents))}</span>}
          hint="Não é lucro nem saldo do banco." />
        <SummaryRows label={`Números de ${formatMonth(month)}`} rows={rows} />
      </Summary>
      {/* A ressalva longa fica recolhida, junto do número que ela explica. */}
      <Help label="Como esse número é feito">
        <p>
          {s.coverage_note} Baseado em {s.records_count} {s.records_count === 1 ? "registro" : "registros"}; atualizado em{" "}
          {formatDate(s.as_of, base.timezone)}. Atendimento agendado ou concluído não conta como recebido. “A receber” só soma
          cobranças já criadas; atendimentos sem cobrança ficam fora até você cobrar.
        </p>
      </Help>
    </section>
  );
}

/**
 * `?atendimento=<id>` (vindo de "Cobrar no Caixa" na Agenda): rola até o atendimento e põe o foco na ação. Sem cobrança,
 * o foco vai para "Recebi"; já cobrado, o recebimento da cobrança abre e o foco vai para o valor. Uma vez por atendimento.
 */
function FocusBooking({ id, value }: { id: string | null; value: MonthData }) {
  const done = useRef<string | null>(null);
  useEffect(() => {
    if (!id || done.current === id) return;
    done.current = id;
    const item = document.getElementById(`fin-b-${id}`) ?? document.querySelector<HTMLElement>(`[data-booking="${CSS.escape(id)}"]`);
    if (!item) return;
    item.scrollIntoView?.({ block: "center" });
    const target = item.querySelector<HTMLElement>("input") ?? item.querySelector<HTMLElement>("button");
    target?.focus();
  }, [id, value]);
  return null;
}
