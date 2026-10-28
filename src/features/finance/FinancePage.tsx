// Caixa registrado (P07): o que entrou, o que saiu e o que falta receber, com período e cobertura.
// Separações que a tela nunca mistura: atendimento concluído ≠ cobrado ≠ recebido; crédito de pacote ≠ caixa.
import { createContext, type FormEvent, type MouseEvent, type ReactNode, useContext, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import type { ExpenseCategory, PackageDetail, PaymentRecord, Receivable, TimeRange, UnchargedBooking } from "@contracts";
import { Button, Card, ConfirmAction, Field, Help, IconButton, PageHeader, StatusBanner, toast, useFormErrors } from "../../components/ui/index.tsx";
import {
  capitalizeFirst,
  centsToInput,
  endOfLocalDay,
  formatCents,
  formatDate,
  formatMonth,
  leftover,
  localDate,
  monthPeriod,
  noonOfLocalDay,
  parseBRL,
  shiftMonth,
  unchargedTotal,
} from "./money.ts";
import { type FinanceBase, type FinancePort, newKey } from "./port.ts";

const PortContext = createContext<FinancePort | null>(null);
export const FinancePortProvider = PortContext.Provider;
function usePort(): FinancePort {
  const p = useContext(PortContext);
  if (!p) throw new Error("usePort fora do Caixa");
  return p;
}

const METHOD_LABEL = { pix: "Pix", cash: "Dinheiro", card: "Cartão", transfer: "Transferência", other: "Outro" } as const;
type Method = keyof typeof METHOD_LABEL;
const CATEGORY_LABEL: Record<ExpenseCategory, string> = {
  supplies: "Material", rent: "Aluguel", utilities: "Contas (luz, água, internet)", fees: "Taxas",
  transport: "Transporte", marketing: "Divulgação", other: "Outro",
};
const STATUS_LABEL: Record<Receivable["status"], string> = {
  open: "Em aberto", partially_paid: "Recebido em parte", paid: "Recebido", cancelled: "Cancelado",
};

/** Explica erros do contrato sem jargão; diz o que NÃO aconteceu. */
function explain(err: unknown): string {
  const e = err as { code?: string; field?: string } | null;
  switch (e?.code) {
    case "POLICY_REJECTED":
      if (e.field === "amount_cents") return "O valor é maior que o que falta receber. Nada foi registrado.";
      if (e.field === "remaining_credits") return "O pacote não tem mais créditos. Nada foi debitado.";
      if (e.field === "package") return "Este atendimento já foi pago com crédito de pacote; cobrar de novo duplicaria a receita.";
      if (e.field === "booking_id") return "Este atendimento já tem cobrança ou crédito usado. Nada foi alterado.";
      if (e.field === "reversal_of" || e.field === "entry_id") return "Isso já foi estornado. Nada foi alterado.";
      return "As regras não permitem esta ação agora. Nada foi alterado.";
    case "VALIDATION_ERROR":
      return e.field === "received_at" || e.field === "paid_at"
        ? "A data não pode ser no futuro. Nada foi registrado."
        : "Confira os dados. Nada foi registrado.";
    case "STALE_VERSION":
      return "Este registro mudou em outro lugar. Atualizamos a lista: revise e tente de novo.";
    case "IDEMPOTENCY_MISMATCH":
      return "Pedido repetido com dados diferentes. Nada novo foi gravado.";
    case "FORBIDDEN":
      return "Só o dono do negócio acessa o caixa.";
    case "PROVIDER_UNAVAILABLE":
    case "INTERNAL_ERROR":
      return "Sem resposta do servidor. Tentar de novo é seguro: o pedido usa a mesma chave e não duplica.";
    default:
      return "Não foi possível concluir. Nada foi alterado por esta tentativa.";
  }
}

/** Mesma chave para o mesmo pedido (repetir não duplica); pedido diferente, chave nova.
 *  Fica num ref, não em estado: dois toques antes do próximo render precisam ver a mesma chave. */
export function useKeyFor() {
  const last = useRef<{ sig: string; key: string } | null>(null);
  return (payload: unknown) => {
    const sig = JSON.stringify(payload);
    if (last.current?.sig !== sig) last.current = { sig, key: newKey() };
    return last.current.key;
  };
}

interface MonthData {
  summary: Awaited<ReturnType<FinancePort["summary"]>>;
  ledger: Awaited<ReturnType<FinancePort["ledger"]>>;
  uncharged: UnchargedBooking[];
  packages: PackageDetail[];
}

interface Ctx {
  base: FinanceBase;
  today: string;
  reload(): void;
  notify(tone: "success" | "danger", text: string): void;
  customerName(id: string | null): string;
  serviceName(id: string): string;
}
const PageContext = createContext<Ctx | null>(null);
const usePage = () => useContext(PageContext)!;

export function FinancePage() {
  const port = usePort();
  const [params, setParams] = useSearchParams();
  const [base, setBase] = useState<FinanceBase | null>(null);
  const [data, setData] = useState<{ month: string; nonce: number; value?: MonthData; error?: unknown } | null>(null);
  const [nonce, setNonce] = useState(0);
  const [baseError, setBaseError] = useState<unknown>(null);

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

  useEffect(() => {
    if (!base) return;
    let alive = true;
    Promise.all([port.summary(period, base.timezone), port.ledger(period), port.uncharged(period), port.packages()]).then(
      ([summary, ledger, uncharged, packages]) => alive && setData({ month, nonce, value: { summary, ledger, uncharged, packages } }),
      (error: unknown) => alive && setData({ month, nonce, error: error ?? new Error("erro") }),
    );
    return () => {
      alive = false;
    };
    // period deriva de month + base.timezone
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [port, base, month, nonce]);

  const go = (m: string) => {
    const p = new URLSearchParams(params);
    p.set("mes", m);
    setParams(p);
  };

  if (baseError) {
    return (
      <Shell demo={port.kind === "demo"}>
        <StatusBanner tone="danger">{explain(baseError)}</StatusBanner>
      </Shell>
    );
  }
  if (!base) {
    return (
      <Shell demo={port.kind === "demo"}>
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
  };
  const current = data && data.month === month && data.nonce === nonce ? data : null;

  return (
    <PageContext.Provider value={ctx}>
      <Shell demo={port.kind === "demo"}>
        <div className="tn-fin-period" role="group" aria-label="Período">
          {/* Não há ícone de seta para a esquerda: a mesma seta, espelhada. */}
          <IconButton icon="voltar" label="Mês anterior" variant="secondary" onClick={() => go(shiftMonth(month, -1))} />
          <strong className="tn-fin-period__label">{capitalizeFirst(formatMonth(month))}</strong>
          <IconButton icon="seta" label="Próximo mês" variant="secondary" onClick={() => go(shiftMonth(month, 1))} disabled={month >= currentMonth} />
        </div>
        {current?.error ? (
          <StatusBanner tone="danger">{explain(current.error)}</StatusBanner>
        ) : !current?.value ? (
          <p role="status">Carregando o mês…</p>
        ) : (
          <>
            <Summary s={current.value.summary} month={month} uncharged={current.value.uncharged} />
            <Uncharged list={current.value.uncharged} packages={current.value.packages} />
            <Receivables list={current.value.ledger.receivables.filter((r) => r.status === "open" || r.status === "partially_paid")} />
            <Payments list={current.value.ledger.payments} />
            <Expenses list={current.value.ledger.expenses} />
            <Packages list={current.value.packages} />
            <NewReceivable />
          </>
        )}
      </Shell>
    </PageContext.Provider>
  );
}

function Shell({ demo, children }: { demo: boolean; children: ReactNode }) {
  return (
    <section aria-labelledby="fin-title" className="tn-fin">
      <PageHeader id="fin-title" title="Caixa" subtitle="Recebíveis, recebimentos manuais e pacotes de sessões." />
      {demo ? (
        <StatusBanner tone="info">
          <strong>Dados de exemplo.</strong> Demonstração sem servidor: esta tela ainda não guarda nem altera dados no servidor;
          as mudanças valem só nesta aba.
        </StatusBanner>
      ) : null}
      {children}
    </section>
  );
}

function Summary({ s, month, uncharged }: { s: MonthData["summary"]; month: string; uncharged: UnchargedBooking[] }) {
  const { base } = usePage();
  const left = leftover(s.received_cents, s.spent_cents);
  const pendingCents = unchargedTotal(uncharged);
  const n = uncharged.length;
  const toPending = (e: MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    const h = document.getElementById("fin-unch-title");
    h?.scrollIntoView({ block: "start" });
    h?.focus();
  };
  return (
    <Card aria-labelledby="fin-sum-title">
      <h2 id="fin-sum-title">Caixa registrado em {formatMonth(month)}</h2>
      <p className="tn-fin-left">
        <span className="tn-fin-left__label">{left.label}</span>
        <strong className="tn-fin-left__value tn-num" data-testid="fin-left">{formatCents(Math.abs(left.cents))}</strong>
        <span className="tn-muted">Entrou menos o que saiu. Não é lucro nem saldo do banco.</span>
      </p>
      <dl className="tn-fin-sum">
        <div>
          <dt>Recebido</dt>
          <dd className="tn-num">{formatCents(s.received_cents)}</dd>
        </div>
        <div>
          <dt>Gasto</dt>
          <dd className="tn-num">{formatCents(s.spent_cents)}</dd>
        </div>
        <div>
          <dt>A receber (hoje)</dt>
          <dd className="tn-num">{formatCents(s.receivable_open_cents)}</dd>
        </div>
      </dl>
      {n > 0 ? (
        <p className="tn-fin-alert">
          <strong>{n} {n === 1 ? "atendimento sem cobrança" : "atendimentos sem cobrança"} · <span className="tn-num">{formatCents(pendingCents)}</span></strong>
          <a href="#fin-unch-title" onClick={toPending}>Cobrar agora →</a>
        </p>
      ) : null}
      <Help label="Como esse número é feito">
        <p>
          {s.coverage_note} Baseado em {s.records_count} {s.records_count === 1 ? "registro" : "registros"}; atualizado em{" "}
          {formatDate(s.as_of, base.timezone)}. Atendimento agendado ou concluído não conta como recebido. “A receber” só soma
          cobranças já criadas; atendimentos sem cobrança ficam fora até você cobrar.
        </p>
      </Help>
    </Card>
  );
}

function MethodField({ id, className, value, onChange }: { id: string; className?: string; value: Method; onChange: (m: Method) => void }) {
  return (
    <Field as="select" label="Forma" id={id} className={className} value={value} onChange={(e) => onChange(e.target.value as Method)}>
      {(Object.keys(METHOD_LABEL) as Method[]).map((m) => (
        <option key={m} value={m}>
          {METHOD_LABEL[m]}
        </option>
      ))}
    </Field>
  );
}

function Uncharged({ list, packages }: { list: UnchargedBooking[]; packages: PackageDetail[] }) {
  const ctx = usePage();
  return (
    <section aria-labelledby="fin-unch-title" className="tn-fin-section">
      <h2 id="fin-unch-title" tabIndex={-1}>Atendimentos concluídos sem cobrança</h2>
      {list.length === 0 ? (
        <p className="tn-muted">Nenhum atendimento concluído pendente neste mês.</p>
      ) : (
        <ul className="tn-fin-list">
          {list.map((b) => (
            <UnchargedItem key={b.booking_id} b={b} packages={packages.filter((p) => b.package_ids.includes(p.package_id))} ctx={ctx} />
          ))}
        </ul>
      )}
    </section>
  );
}

function UnchargedItem({ b, packages, ctx }: { b: UnchargedBooking; packages: PackageDetail[]; ctx: Ctx }) {
  const port = usePort();
  // Uma chave por registro: repetir depois de falha reaproveita a cobrança já criada e não duplica nada.
  const chargeKey = useKeyFor();
  const payKey = useKeyFor();
  const creditKey = useKeyFor();
  // Instante do recebimento fixado na tela: a repetição envia exatamente o mesmo pedido.
  const [receivedAt] = useState(() => port.now().toISOString());
  const [method, setMethod] = useState<Method>("pix");
  // Qual ação está rodando: o carregando aparece só no botão tocado; os outros esperam.
  const [pending, setPending] = useState<string | null>(null);
  const label = `${ctx.serviceName(b.service_id)} · ${ctx.customerName(b.customer_id)}`;

  async function run(which: string, action: () => Promise<string>) {
    setPending(which);
    try {
      ctx.notify("success", await action());
    } catch (err) {
      ctx.notify("danger", explain(err));
    } finally {
      setPending(null);
      ctx.reload();
    }
  }

  // Cobrança e recebimento são dois registros. Se o segundo falhar, a cobrança fica em aberto e visível.
  const markPaid = () =>
    run("paid", async () => {
      const r = await port.chargeBooking({ booking_id: b.booking_id }, chargeKey({ charge: b.booking_id }));
      const payment = { receivable_id: r.id, amount_cents: r.amount_cents, method, received_at: receivedAt };
      await port.recordPayment(payment, payKey(payment));
      return `Recebido ${formatCents(r.amount_cents)} (${METHOD_LABEL[method]}) de ${label}. Registro manual.`;
    });
  const chargeLater = () =>
    run("later", async () => {
      const r = await port.chargeBooking({ booking_id: b.booking_id }, chargeKey({ charge: b.booking_id }));
      return `Cobrança de ${formatCents(r.amount_cents)} criada. Fica em "A receber" até registrar o recebimento.`;
    });
  const consumeCredit = (pkgId: string) =>
    run(pkgId, async () => {
      if (!b.completed_event_id) throw { code: "POLICY_REJECTED", field: "event_id" };
      const bal = await port.consumePackage({ package_id: pkgId, booking_id: b.booking_id, event_id: b.completed_event_id }, creditKey({ consume: b.booking_id, pkgId }));
      return `Crédito usado. Saldo: ${bal.remaining_credits} ${bal.remaining_credits === 1 ? "sessão" : "sessões"}. Nenhum valor novo entra no caixa.`;
    });

  return (
    <li className="tn-fin-item">
      <div>
        <strong>{label}</strong>
        <span className="tn-muted tn-num">
          {" "}
          {formatDate(b.starts_at, ctx.base.timezone)} · {formatCents(b.agreed_price_cents)}
        </span>
      </div>
      <div className="tn-actions">
        {b.agreed_price_cents ? (
          <>
            <MethodField id={`m-${b.booking_id}`} className="tn-fin-inline" value={method} onChange={setMethod} />
            <Button loading={pending === "paid"} disabled={!!pending} onClick={() => void markPaid()}>
              Marcar como recebido<span className="tn-visually-hidden"> {label}</span>
            </Button>
            <Button variant="secondary" loading={pending === "later"} disabled={!!pending} onClick={() => void chargeLater()}>
              Cobrar depois<span className="tn-visually-hidden"> {label}</span>
            </Button>
          </>
        ) : null}
        {packages.map((p) => (
          <Button key={p.package_id} variant="secondary" loading={pending === p.package_id} disabled={!!pending} onClick={() => void consumeCredit(p.package_id)}>
            Usar crédito do pacote ({p.remaining_credits} restantes)
          </Button>
        ))}
      </div>
    </li>
  );
}

function Receivables({ list }: { list: Receivable[] }) {
  const ctx = usePage();
  return (
    <section aria-labelledby="fin-rec-title" className="tn-fin-section">
      <h2 id="fin-rec-title">A receber</h2>
      {list.length === 0 ? (
        <p className="tn-muted">Nada em aberto.</p>
      ) : (
        <ul className="tn-fin-list">
          {list.map((r) => (
            <ReceivableItem key={r.id} r={r} ctx={ctx} />
          ))}
        </ul>
      )}
    </section>
  );
}

function ReceivableItem({ r, ctx }: { r: Receivable; ctx: Ctx }) {
  const port = usePort();
  const keyFor = useKeyFor();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(centsToInput(r.open_cents));
  const [method, setMethod] = useState<Method>("pix");
  const [date, setDate] = useState(ctx.today);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { formRef, errors, show } = useFormErrors<"amount">();

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const cents = parseBRL(amount);
    const amountError = !cents
      ? "Informe o valor recebido."
      : cents > r.open_cents
        ? `O valor passa do que falta receber (${formatCents(r.open_cents)}).`
        : null;
    if (!show({ amount: amountError }) || !cents) return;
    const received_at = date === ctx.today ? port.now().toISOString() : noonOfLocalDay(date, ctx.base.timezone);
    const payload = { receivable_id: r.id, amount_cents: cents, method, received_at };
    setPending(true);
    setError(null);
    try {
      await port.recordPayment(payload, keyFor(payload));
      ctx.notify("success", `Recebimento de ${formatCents(cents)} registrado (${METHOD_LABEL[method]}, manual).`);
      ctx.reload();
    } catch (err) {
      setError(explain(err));
    } finally {
      setPending(false);
    }
  }

  async function cancel() {
    try {
      await port.cancelReceivable({ receivable_id: r.id, expected_version: r.version }, newKey());
      ctx.notify("success", "Cobrança cancelada.");
    } catch (err) {
      ctx.notify("danger", explain(err));
    } finally {
      ctx.reload();
    }
  }

  return (
    <li className="tn-fin-item">
      <div>
        <strong>{r.description}</strong> <span className="tn-muted">· {ctx.customerName(r.customer_id)}</span>
        <div className="tn-muted tn-num">
          Falta {formatCents(r.open_cents)} de {formatCents(r.amount_cents)} · {STATUS_LABEL[r.status]}
          {r.due_at ? ` · vence ${formatDate(r.due_at, ctx.base.timezone)}` : ""}
        </div>
      </div>
      {open ? (
        <form ref={formRef} className="tn-fin-form" onSubmit={(e) => void submit(e)} noValidate>
          <Field label="Valor recebido (R$)" id={`a-${r.id}`} inputMode="decimal" value={amount} error={errors.amount} onChange={(e) => setAmount(e.target.value)} />
          <MethodField id={`m-${r.id}`} value={method} onChange={setMethod} />
          <Field label="Data" id={`d-${r.id}`} type="date" max={ctx.today} value={date} onChange={(e) => setDate(e.target.value)} />
          {error ? <StatusBanner tone="danger">{error}</StatusBanner> : null}
          <div className="tn-actions">
            <Button type="submit" loading={pending}>Registrar pagamento</Button>
            <Button variant="ghost" onClick={() => setOpen(false)}>Fechar</Button>
          </div>
        </form>
      ) : (
        <div className="tn-actions">
          <Button variant="secondary" onClick={() => setOpen(true)}>
            Registrar recebimento<span className="tn-visually-hidden"> de {r.description}</span>
          </Button>
          {r.status === "open" && !r.package_id ? (
            <ConfirmAction
              trigger="Cancelar cobrança"
              triggerLabel={`Cancelar cobrança de ${r.description}`}
              title="Cancelar cobrança?"
              consequence={`${r.description} (${formatCents(r.amount_cents)}) sai de "A receber". Para cobrar de novo, crie outra cobrança.`}
              confirmLabel="Sim, cancelar"
              onConfirm={cancel}
            />
          ) : null}
        </div>
      )}
    </li>
  );
}

/** Estorno: não volta atrás, então confirma com a consequência e pede o motivo quando o contrato guarda. */
function ReverseButton({ label, consequence, withReason = true, onReverse }: {
  label: string; consequence: string; withReason?: boolean; onReverse: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  return (
    <ConfirmAction
      trigger="Estornar"
      triggerLabel={`Estornar ${label}`}
      title={`Estornar ${label}?`}
      consequence={consequence}
      confirmLabel="Sim, estornar"
      canConfirm={!withReason || !!reason.trim()}
      missingHint="Escreva o motivo do estorno."
      onConfirm={() => onReverse(reason.trim())}
    >
      {withReason ? <Field label="Motivo do estorno" maxLength={280} value={reason} onChange={(e) => setReason(e.target.value)} /> : null}
    </ConfirmAction>
  );
}

function Payments({ list }: { list: PaymentRecord[] }) {
  const ctx = usePage();
  const port = usePort();
  const reverse = (p: PaymentRecord) => async (reason: string) => {
    try {
      await port.reversePayment({ payment_id: p.id, reason }, newKey());
      ctx.notify("success", `Recebimento de ${formatCents(p.amount_cents)} estornado. O registro original continua no histórico.`);
    } catch (err) {
      ctx.notify("danger", explain(err));
    } finally {
      ctx.reload();
    }
  };
  return (
    <section aria-labelledby="fin-pay-title" className="tn-fin-section">
      <h2 id="fin-pay-title">Recebimentos no mês</h2>
      {list.length === 0 ? (
        <p className="tn-muted">Nenhum recebimento registrado.</p>
      ) : (
        <ul className="tn-fin-list">
          {list.map((p) => (
            <li key={p.id} className="tn-fin-item">
              <div className="tn-num">
                {p.reversal_of ? <strong>Estorno de {formatCents(p.amount_cents)}</strong> : <strong>{formatCents(p.amount_cents)}</strong>}
                <span className="tn-muted">
                  {" "}
                  · {METHOD_LABEL[p.method]} · {formatDate(p.received_at, ctx.base.timezone)} · {ctx.customerName(p.customer_id)} · manual
                  {p.reversed ? " · estornado" : ""}
                </span>
              </div>
              {!p.reversal_of && !p.reversed ? (
                <ReverseButton label={`recebimento de ${formatCents(p.amount_cents)}`} onReverse={reverse(p)}
                  consequence={`Sai ${formatCents(p.amount_cents)} do recebido no mês. O registro original continua no histórico.`} />
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Expenses({ list }: { list: Awaited<ReturnType<FinancePort["ledger"]>>["expenses"] }) {
  const ctx = usePage();
  const port = usePort();
  const keyFor = useKeyFor();
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState<ExpenseCategory>("supplies");
  const [date, setDate] = useState(ctx.today);
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const { formRef, errors, show } = useFormErrors<"amount">();

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const cents = parseBRL(amount);
    if (!show({ amount: !cents && "Informe o valor da despesa." }) || !cents) return;
    const payload = {
      amount_cents: cents, category, description: description.trim() || null,
      paid_at: date === ctx.today ? port.now().toISOString() : noonOfLocalDay(date, ctx.base.timezone),
    };
    setPending(true);
    setError(null);
    try {
      await port.recordExpense(payload, keyFor(payload));
      ctx.notify("success", `Despesa de ${formatCents(cents)} registrada.`);
      setAmount("");
      setDescription("");
      ctx.reload();
    } catch (err) {
      setError(explain(err));
    } finally {
      setPending(false);
    }
  }

  const reverse = (id: string) => async (_reason: string) => {
    try {
      await port.reverseExpense({ expense_id: id }, newKey());
      ctx.notify("success", "Despesa estornada. O registro original continua no histórico.");
    } catch (err) {
      ctx.notify("danger", explain(err));
    } finally {
      ctx.reload();
    }
  };

  return (
    <section aria-labelledby="fin-exp-title" className="tn-fin-section">
      <h2 id="fin-exp-title">Despesas</h2>
      <form ref={formRef} className="tn-fin-form" onSubmit={(e) => void submit(e)} noValidate aria-label="Nova despesa">
        <Field label="Valor da despesa (R$)" id="exp-amount" inputMode="decimal" value={amount} error={errors.amount} onChange={(e) => setAmount(e.target.value)} />
        <Field as="select" label="Categoria" id="exp-cat" value={category} onChange={(e) => setCategory(e.target.value as ExpenseCategory)}>
          {(Object.keys(CATEGORY_LABEL) as ExpenseCategory[]).map((c) => (
            <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>
          ))}
        </Field>
        <Field label="Data da despesa" id="exp-date" type="date" max={ctx.today} value={date} onChange={(e) => setDate(e.target.value)} />
        <Field label="Descrição (opcional)" id="exp-desc" maxLength={120} value={description} onChange={(e) => setDescription(e.target.value)} />
        {error ? <StatusBanner tone="danger">{error}</StatusBanner> : null}
        <Button type="submit" loading={pending}>Registrar despesa</Button>
      </form>
      {list.length === 0 ? (
        <p className="tn-muted">Nenhuma despesa no mês.</p>
      ) : (
        <ul className="tn-fin-list">
          {list.map((x) => (
            <li key={x.id} className="tn-fin-item">
              <div className="tn-num">
                <strong>{x.reversal_of ? `Estorno de ${formatCents(x.amount_cents)}` : formatCents(x.amount_cents)}</strong>
                <span className="tn-muted">
                  {" "}
                  · {CATEGORY_LABEL[x.category]}{x.description ? ` · ${x.description}` : ""} · {formatDate(x.paid_at, ctx.base.timezone)}
                  {x.reversed ? " · estornada" : ""}
                </span>
              </div>
              {!x.reversal_of && !x.reversed ? (
                // O contrato do estorno de despesa não guarda motivo: confirma sem pedir um texto que seria descartado.
                <ReverseButton label={`despesa de ${formatCents(x.amount_cents)}`} withReason={false} onReverse={reverse(x.id)}
                  consequence={`Sai ${formatCents(x.amount_cents)} do gasto no mês. O registro original continua no histórico.`} />
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Packages({ list }: { list: PackageDetail[] }) {
  const ctx = usePage();
  const port = usePort();
  const keyFor = useKeyFor();
  const active = ctx.base.services.filter((s) => s.active);
  const [selling, setSelling] = useState(false);
  const [customer, setCustomer] = useState("");
  const [service, setService] = useState(active[0]?.id ?? "");
  const [credits, setCredits] = useState("10");
  const [total, setTotal] = useState("");
  const [expires, setExpires] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const { formRef, errors, show } = useFormErrors<"customer" | "credits" | "total">();

  async function sell(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const n = Number(credits);
    const cents = parseBRL(total);
    const ok = show({
      customer: !customer && "Escolha o cliente.",
      credits: (!Number.isInteger(n) || n < 1 || n > 500) && "Informe de 1 a 500 sessões.",
      total: !cents && "Informe o valor total do pacote.",
    });
    if (!ok || !cents) return;
    const payload = {
      customer_id: customer, service_id: service, credits: n, total_price_cents: cents,
      expires_at: expires ? endOfLocalDay(expires, ctx.base.timezone) : null,
    };
    setPending(true);
    setError(null);
    try {
      await port.sellPackage(payload, keyFor(payload));
      ctx.notify("success", `Pacote de ${n} sessões vendido. Um único valor de ${formatCents(cents)} ficou em "A receber".`);
      setSelling(false);
      ctx.reload();
    } catch (err) {
      setError(explain(err));
    } finally {
      setPending(false);
    }
  }

  const reverse = (entryId: string) => async (reason: string) => {
    try {
      await port.reversePackage({ entry_id: entryId, reason }, newKey());
      ctx.notify("success", "Crédito devolvido ao pacote. O débito original continua no histórico.");
    } catch (err) {
      ctx.notify("danger", explain(err));
    } finally {
      ctx.reload();
    }
  };

  return (
    <section aria-labelledby="fin-pkg-title" className="tn-fin-section">
      <h2 id="fin-pkg-title">Pacotes de sessões</h2>
      <p className="tn-muted">Vender o pacote gera um único valor a receber. Usar uma sessão debita crédito, não gera caixa.</p>
      {selling ? (
        <form ref={formRef} className="tn-fin-form" onSubmit={(e) => void sell(e)} noValidate aria-label="Vender pacote">
          <Field as="select" label="Cliente" id="pkg-customer" value={customer} error={errors.customer} onChange={(e) => setCustomer(e.target.value)}>
            <option value="">Escolha…</option>
            {ctx.base.customers.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Field>
          <Field as="select" label="Serviço" id="pkg-service" value={service} onChange={(e) => setService(e.target.value)}>
            {active.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </Field>
          <Field label="Sessões" id="pkg-credits" inputMode="numeric" value={credits} error={errors.credits} onChange={(e) => setCredits(e.target.value)} />
          <Field label="Valor total (R$)" id="pkg-total" inputMode="decimal" value={total} error={errors.total} onChange={(e) => setTotal(e.target.value)} />
          <Field label="Validade (opcional)" id="pkg-exp" type="date" min={ctx.today} value={expires} onChange={(e) => setExpires(e.target.value)} />
          {error ? <StatusBanner tone="danger">{error}</StatusBanner> : null}
          <div className="tn-actions">
            <Button type="submit" loading={pending}>Confirmar venda</Button>
            <Button variant="ghost" onClick={() => setSelling(false)}>Fechar</Button>
          </div>
        </form>
      ) : (
        <Button variant="secondary" onClick={() => setSelling(true)}>Vender pacote</Button>
      )}
      {list.length === 0 ? (
        <p className="tn-muted">Nenhum pacote vendido.</p>
      ) : (
        <ul className="tn-fin-list">
          {list.map((p) => (
            <li key={p.package_id} className="tn-fin-item tn-fin-item--column">
              <div>
                <strong>
                  {ctx.serviceName(p.service_id)} · {ctx.customerName(p.customer_id)}
                </strong>
                <div className="tn-num">
                  Saldo: {p.remaining_credits} {p.remaining_credits === 1 ? "sessão" : "sessões"} de {p.purchased_credits}
                  <span className="tn-muted">
                    {" "}
                    · {formatCents(p.total_price_cents)} contratado
                    {p.expires_at ? ` · válido até ${formatDate(p.expires_at, ctx.base.timezone)}` : ""}
                  </span>
                </div>
              </div>
              {p.entries.length ? (
                <ul className="tn-fin-entries">
                  {p.entries.map((e) => (
                    <li key={e.id} className="tn-fin-item">
                      <span className="tn-num">
                        {e.reason === "consume" ? "Sessão usada (−1)" : "Crédito devolvido (+1)"} · {formatDate(e.created_at, ctx.base.timezone)}
                        {e.reversed ? " · estornado" : ""}
                      </span>
                      {e.reason === "consume" && !e.reversed ? <ReverseButton label={`sessão usada em ${formatDate(e.created_at, ctx.base.timezone)}`} onReverse={reverse(e.id)} consequence="A sessão volta ao saldo do pacote. O registro original continua no histórico." /> : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function NewReceivable() {
  const ctx = usePage();
  const port = usePort();
  const keyFor = useKeyFor();
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [customer, setCustomer] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const { formRef, errors, show } = useFormErrors<"description" | "amount">();

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const cents = parseBRL(amount);
    const ok = show({ description: !description.trim() && "Descreva a cobrança.", amount: !cents && "Informe o valor." });
    if (!ok || !cents) return;
    const payload = { description: description.trim(), amount_cents: cents, customer_id: customer || null };
    setPending(true);
    setError(null);
    try {
      await port.createReceivable(payload, keyFor(payload));
      ctx.notify("success", `Cobrança de ${formatCents(cents)} criada em "A receber".`);
      setDescription("");
      setAmount("");
      ctx.reload();
    } catch (err) {
      setError(explain(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <section aria-labelledby="fin-new-title" className="tn-fin-section">
      <h2 id="fin-new-title">Outra cobrança</h2>
      <p className="tn-muted">Produto vendido, sinal ou valor combinado fora da agenda.</p>
      <form ref={formRef} className="tn-fin-form" onSubmit={(e) => void submit(e)} noValidate aria-label="Nova cobrança">
        <Field label="Descrição" id="rec-desc" maxLength={120} value={description} error={errors.description} onChange={(e) => setDescription(e.target.value)} />
        <Field label="Valor (R$)" id="rec-amount" inputMode="decimal" value={amount} error={errors.amount} onChange={(e) => setAmount(e.target.value)} />
        <Field as="select" label="Cliente (opcional)" id="rec-customer" value={customer} onChange={(e) => setCustomer(e.target.value)}>
          <option value="">Sem cliente</option>
          {ctx.base.customers.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </Field>
        {error ? <StatusBanner tone="danger">{error}</StatusBanner> : null}
        <Button type="submit" loading={pending}>Criar cobrança</Button>
      </form>
    </section>
  );
}
