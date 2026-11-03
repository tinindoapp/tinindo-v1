// Contas (P31): demonstrativo de caixa do mês, contas a pagar, conferência dos recebimentos e categorias. O que a tela
// promete é o que o banco garante: pagar lança uma despesa no Caixa e pagar de novo não lança outra; o estorno volta a
// conta para "a pagar"; o demonstrativo diz o período, o fuso e o que falta lançar, e não é DRE.
import { type FormEvent, useEffect, useState } from "react";
import { Button, Card, ConfirmAction, Field, Help, PageHeader, Segmented, Stat, Stats, StatusBanner, toast, useFormErrors } from "../../components/ui/index.tsx";
import { Icon } from "../../components/ui/icons.tsx";
import {
  addDays, BASE_LABEL, EXPENSE_BASES, explain, formatCents, formatDay, METHOD_LABEL, monthLabel, parseBRL, periodLabel, SOURCE_LABEL, STATUS_LABEL,
} from "./labels.ts";
import {
  type AccCategory, type AccEntry, type AccountsBase, type AccountsPort, type AccPayable, type AccReconciliationRow, type AccSeries, type AccStatement, newKey,
} from "./port.ts";

type Tab = "month" | "payables" | "reconcile" | "categories";
const fail = (err: unknown) => toast({ tone: "danger", message: explain(err) });
/** Categoria de origem: a do Caixa (despesa) ou a origem do recebimento (atendimento, pacote, outras). */
const originLabel = (e: AccEntry) => (e.entry_kind === "payment" && e.base === "other" ? "Outras receitas" : BASE_LABEL[e.base] ?? "Outras");

function PayableForm({ port, base, categories, onDone }: { port: AccountsPort; base: AccountsBase; categories: AccCategory[]; onDone: () => void }) {
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [due, setDue] = useState(base.today);
  const [cat, setCat] = useState("base:other");
  const [supplier, setSupplier] = useState("");
  const [monthly, setMonthly] = useState(false);
  const [busy, setBusy] = useState(false);
  const { formRef, errors, show } = useFormErrors<"description" | "amount" | "due">();
  async function submit(e: FormEvent) {
    e.preventDefault();
    const ok = show({
      description: !description.trim() && "Diga o que é a conta (ex.: aluguel).",
      amount: !(parseBRL(amount || "0") > 0) && "Informe o valor.",
      due: (!due && "Informe o vencimento.") || (monthly && Number(due.slice(8, 10)) > 28 && "Conta mensal vence entre os dias 1 e 28."),
    });
    if (!ok) return;
    setBusy(true);
    try {
      const custom = cat.startsWith("cat:") ? cat.slice(4) : null;
      const r = await port.savePayable({ description: description.trim(), amount_cents: parseBRL(amount), due_on: due, monthly, supplier: supplier.trim() || null,
        category_id: custom, base_category: custom ? "other" : (cat.slice(5) as AccPayable["base_category"]) }, newKey());
      toast(r.created > 1 ? `“${r.payable.description}” todo mês: ${r.created} contas criadas, a primeira vence em ${formatDay(r.payable.due_on)}.`
        : `Conta “${r.payable.description}” criada para ${formatDay(r.payable.due_on)}.`);
      onDone();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form ref={formRef} className="tn-acc-form" aria-label="Nova conta a pagar" onSubmit={(e) => void submit(e)} noValidate>
      <Field label="O que é" value={description} maxLength={120} error={errors.description} onChange={(e) => setDescription(e.target.value)} placeholder="Aluguel do salão" />
      <Field label="Valor (R$)" inputMode="decimal" value={amount} error={errors.amount} onChange={(e) => setAmount(e.target.value)} />
      <Field label="Vencimento" type="date" value={due} error={errors.due} onChange={(e) => setDue(e.target.value)} />
      <Field as="select" label="Categoria" value={cat} onChange={(e) => setCat(e.target.value)}>
        {categories.filter((c) => c.kind === "expense" && c.active).map((c) => <option key={c.id} value={`cat:${c.id}`}>{c.name}</option>)}
        {EXPENSE_BASES.map((b) => <option key={b} value={`base:${b}`}>{BASE_LABEL[b]}</option>)}
      </Field>
      <Field label="Fornecedor (opcional)" value={supplier} maxLength={80} onChange={(e) => setSupplier(e.target.value)} />
      <label className="tn-acc-check"><input type="checkbox" checked={monthly} onChange={(e) => setMonthly(e.target.checked)} /> Repetir todo mês (cria os próximos 12 meses)</label>
      <div className="tn-actions"><Button type="submit" loading={busy}>Criar conta</Button></div>
    </form>
  );
}

function PayableRow({ p, port, onChange }: { p: AccPayable; port: AccountsPort; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  async function pay() {
    setBusy(true);
    try {
      const paid = await port.pay(p, new Date().toISOString(), newKey());
      onChange();
      toast({ message: `“${p.description}” paga: ${formatCents(p.amount_cents)} saiu no Caixa.`, action: { label: "Desfazer", onAction: async () => {
        try { await port.reverse(paid, newKey()); toast("Pagamento desfeito: a despesa foi estornada no Caixa."); } catch (err) { fail(err); }
        onChange();
      } } });
    } catch (err) {
      fail(err);
      onChange();
    } finally {
      setBusy(false);
    }
  }
  return (
    <li className="tn-acc-item" data-status={p.status}>
      <div>
        <strong>{p.description}</strong>{p.supplier ? ` · ${p.supplier}` : ""}
        <div className="tn-muted">vence {formatDay(p.due_on)} · {p.category_name ?? BASE_LABEL[p.base_category]}{p.series_id ? " · todo mês" : ""}{p.reversals ? ` · ${p.reversals} estorno(s)` : ""}</div>
      </div>
      <div className="tn-acc-right">
        <span className="tn-num">{formatCents(p.amount_cents)}</span>
        <span className="tn-acc-status">{STATUS_LABEL[p.status]}</span>
      </div>
      <div className="tn-actions">
        {p.status === "open" || p.status === "overdue" ? (
          <>
            <Button variant="secondary" loading={busy} onClick={() => void pay()} aria-label={`Pagar ${p.description} de ${formatDay(p.due_on)}`}>Pagar</Button>
            <ConfirmAction trigger="Cancelar" triggerLabel={`Cancelar ${p.description} de ${formatDay(p.due_on)}`} title="Cancelar esta conta?"
              consequence={<p>Ela sai da lista de contas a pagar e não entra no Caixa. Para voltar, crie a conta de novo.</p>} confirmLabel="Sim, cancelar"
              onConfirm={async () => { try { await port.cancel(p, newKey()); toast("Conta cancelada."); onChange(); } catch (err) { fail(err); throw err; } }} />
          </>
        ) : null}
        {p.status === "paid" ? (
          <ConfirmAction trigger="Estornar pagamento" triggerLabel={`Estornar pagamento de ${p.description}`} title="Estornar o pagamento?"
            consequence={<p>A despesa de {formatCents(p.amount_cents)} recebe um estorno no Caixa e a conta volta a ficar a pagar.</p>} confirmLabel="Sim, estornar"
            onConfirm={async () => { try { await port.reverse(p, newKey()); toast("Pagamento estornado no Caixa."); onChange(); } catch (err) { fail(err); throw err; } }} />
        ) : null}
      </div>
    </li>
  );
}

function SeriesRow({ s, port, onChange }: { s: AccSeries; port: AccountsPort; onChange: () => void }) {
  return (
    <li className="tn-acc-item">
      <div>
        <strong>{s.description}</strong> · todo dia {s.day_of_month} · {formatCents(s.amount_cents)}
        <div className="tn-muted">{s.active ? `contas criadas até ${formatDay(s.generated_until)}` : "encerrada"}</div>
      </div>
      {s.active ? (
        <div className="tn-actions">
          <Button variant="ghost" onClick={() => void port.updateSeries(s, "extend", newKey()).then((r) => { toast(`${r.affected} contas novas de “${s.description}”.`); onChange(); }, fail)}>
            Criar mais 12 meses
          </Button>
          <ConfirmAction trigger="Encerrar" triggerLabel={`Encerrar ${s.description}`} title={`Encerrar “${s.description}”?`}
            consequence={<p>As contas futuras ainda não pagas são canceladas. As já pagas ficam como estão.</p>} confirmLabel="Sim, encerrar"
            onConfirm={async () => { try { const r = await port.updateSeries(s, "end", newKey()); toast(`Encerrada: ${r.affected} conta(s) futura(s) cancelada(s).`); onChange(); } catch (err) { fail(err); throw err; } }} />
        </div>
      ) : null}
    </li>
  );
}

function StatementView({ st, entries, categories, port, onChange }: { st: AccStatement; entries: AccEntry[]; categories: AccCategory[]; port: AccountsPort; onChange: () => void }) {
  const c = st.coverage;
  const gaps = [
    c.uncharged_bookings ? `${c.uncharged_bookings} atendimento(s) concluído(s) sem cobrança (${formatCents(c.uncharged_cents)})` : null,
    c.payables_unpaid ? `${c.payables_unpaid} conta(s) do mês ainda não paga(s) (${formatCents(c.payables_unpaid_cents)})` : null,
    c.receivables_open_cents ? `${formatCents(c.receivables_open_cents)} a receber já vencido (não entrou)` : null,
    c.days_unreconciled ? `${c.days_unreconciled} dia(s) com recebimento sem conferir o extrato` : null,
    c.unclassified_entries ? `${c.unclassified_entries} lançamento(s) sem categoria própria (ficam na categoria de origem)` : null,
  ].filter(Boolean);
  return (
    <>
      <Card aria-labelledby="acc-month-title">
        <h2 id="acc-month-title">Caixa de {monthLabel(st.period.month)}</h2>
        <p className="tn-muted">Período: {periodLabel(st.period)} · fuso {st.period.timezone}. Regime de caixa: o que foi registrado como recebido e pago.</p>
        <Stats label="Resumo do mês">
          <Stat label="Entrou" value={formatCents(st.in_cents)} />
          <Stat label="Saiu" value={formatCents(st.out_cents)} />
          <Stat label="Sobrou" value={formatCents(st.net_cents)} hint={st.net_cents < 0 ? "saiu mais do que entrou" : undefined} />
        </Stats>
        <div className="tn-acc-cols">
          <section aria-label="Entradas por categoria">
            <h3>Entradas</h3>
            {st.income.length ? <ul className="tn-acc-lines">{st.income.map((l) => <li key={l.key}><span>{l.label}</span><span className="tn-num">{formatCents(l.cents)}</span></li>)}</ul>
              : <p className="tn-muted">Nada registrado.</p>}
          </section>
          <section aria-label="Saídas por categoria">
            <h3>Saídas</h3>
            {st.expenses.length ? <ul className="tn-acc-lines">{st.expenses.map((l) => <li key={l.key}><span>{l.label}</span><span className="tn-num">{formatCents(l.cents)}</span></li>)}</ul>
              : <p className="tn-muted">Nada registrado.</p>}
          </section>
        </div>
        <section aria-label="O que falta lançar" className="tn-acc-coverage">
          <h3>O que falta lançar</h3>
          {gaps.length ? <ul>{gaps.map((g) => <li key={g}>{g}</li>)}</ul> : <p>Nada pendente: o mês está completo no que a Tinindo enxerga.</p>}
          {c.fiscal_authorized ? <p className="tn-muted">Notas fiscais autorizadas no mês: {c.fiscal_authorized} ({formatCents(c.fiscal_authorized_cents)}). Nota não é dinheiro: não entra no caixa.</p> : null}
        </section>
        <StatusBanner tone="info">{st.note}</StatusBanner>
      </Card>
      <Card aria-labelledby="acc-entries-title">
        <h2 id="acc-entries-title">Lançamentos do mês</h2>
        <p className="tn-muted">Escolha a categoria própria de cada recebimento ou despesa. Sem escolha, vale a categoria de origem.</p>
        {entries.length === 0 ? <p className="tn-muted">Nenhum lançamento no mês.</p> : null}
        <ul className="tn-acc-list" aria-label="Lançamentos para classificar">
          {entries.map((e) => (
            <li key={e.entry_id} className="tn-acc-item">
              <div>
                <strong>{e.entry_kind === "payment" ? "Entrou" : "Saiu"} {formatCents(e.amount_cents)}</strong> · {e.description || BASE_LABEL[e.base]}
                <div className="tn-muted">{new Date(e.at).toLocaleDateString("pt-BR", { timeZone: st.period.timezone })}{e.method ? ` · ${METHOD_LABEL[e.method]}` : ""}</div>
              </div>
              <Field as="select" label="Categoria" className="tn-acc-classify" value={e.category_id ?? ""}
                onChange={(ev) => void port.classify(e, ev.target.value || null, newKey()).then(() => { toast("Categoria salva."); onChange(); }, fail)}>
                <option value="">{originLabel(e)} (de origem)</option>
                {categories.filter((c2) => c2.active && c2.kind === (e.entry_kind === "payment" ? "income" : "expense")).map((c2) => <option key={c2.id} value={c2.id}>{c2.name}</option>)}
              </Field>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}

function ReconcileRow({ r, day, port, onChange }: { r: AccReconciliationRow; day: string; port: AccountsPort; onChange: () => void }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const { formRef, errors, show } = useFormErrors<"value">();
  const label = `${METHOD_LABEL[r.method]} ${SOURCE_LABEL[r.source]}`;
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!show({ value: (value.trim() === "" || !(parseBRL(value) >= 0)) && "Informe o valor que aparece no extrato." })) return;
    setBusy(true);
    try {
      const diff = await port.reconcile(day, r.method, r.source, parseBRL(value), newKey());
      toast(diff === 0 ? `${label}: bate com o extrato.` : { tone: "warning", message: `${label}: diferença de ${formatCents(diff)} em relação ao registrado.` });
      setValue("");
      onChange();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }
  return (
    <li className="tn-acc-item">
      <div>
        <strong>{label}</strong>
        <div className="tn-muted">registrado {formatCents(r.ledger_cents)} em {r.entries} recebimento(s)
          {r.partner_paid_cents !== null ? ` · o provedor diz ${formatCents(r.partner_paid_cents)}` : ""}
          {r.partner_differences ? ` · ${r.partner_differences} diferença(s) na conciliação do provedor` : ""}</div>
        {r.statement ? <div className={r.statement.difference_cents === 0 ? "tn-acc-ok" : "tn-acc-diff"}>
          {r.statement.difference_cents === 0 ? "Conferido: bate com o extrato" : `Conferido com diferença de ${formatCents(r.statement.difference_cents)}`} ({formatCents(r.statement.statement_cents)} no extrato)
        </div> : <div className="tn-muted">Ainda não conferido.</div>}
      </div>
      <form ref={formRef} className="tn-acc-form" aria-label={`Conferir ${label}`} onSubmit={(e) => void submit(e)} noValidate>
        <Field label="Valor no extrato (R$)" inputMode="decimal" value={value} error={errors.value} onChange={(e) => setValue(e.target.value)} />
        <Button type="submit" variant="secondary" loading={busy}>Conferir</Button>
      </form>
    </li>
  );
}

function CategoryForm({ port, onDone }: { port: AccountsPort; onDone: () => void }) {
  const [kind, setKind] = useState<"income" | "expense">("expense");
  const [name, setName] = useState("");
  const [baseCat, setBaseCat] = useState<(typeof EXPENSE_BASES)[number]>("other");
  const [busy, setBusy] = useState(false);
  const { formRef, errors, show } = useFormErrors<"name">();
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!show({ name: !name.trim() && "Dê um nome à categoria." })) return;
    setBusy(true);
    try {
      const c = await port.saveCategory({ kind, name: name.trim(), base: kind === "expense" ? baseCat : null }, newKey());
      toast(`Categoria “${c.name}” criada.`);
      setName("");
      onDone();
    } catch (err) {
      if ((err as { field?: string }).field === "name") show({ name: explain(err) });
      else fail(err);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form ref={formRef} className="tn-acc-form" aria-label="Nova categoria" onSubmit={(e) => void submit(e)} noValidate>
      <Segmented label="Tipo" value={kind} onChange={setKind} options={[{ value: "expense", label: "Despesa" }, { value: "income", label: "Receita" }]} />
      <Field label="Nome" value={name} maxLength={60} error={errors.name} onChange={(e) => setName(e.target.value)} />
      {kind === "expense" ? (
        <Field as="select" label="Entra no Caixa como" value={baseCat} onChange={(e) => setBaseCat(e.target.value as typeof baseCat)}>
          {EXPENSE_BASES.map((b) => <option key={b} value={b}>{BASE_LABEL[b]}</option>)}
        </Field>
      ) : null}
      <div className="tn-actions"><Button type="submit" loading={busy}>Criar categoria</Button></div>
    </form>
  );
}

export function AccountsPage({ port }: { port: AccountsPort }) {
  const [tab, setTab] = useState<Tab>("month");
  const [base, setBase] = useState<AccountsBase | null>(null);
  const [month, setMonth] = useState("");
  const [day, setDay] = useState("");
  const [categories, setCategories] = useState<AccCategory[]>([]);
  const [st, setSt] = useState<AccStatement | null>(null);
  const [entries, setEntries] = useState<AccEntry[]>([]);
  const [pays, setPays] = useState<{ payables: AccPayable[]; series: AccSeries[] } | null>(null);
  const [rows, setRows] = useState<AccReconciliationRow[] | null>(null);
  const [composing, setComposing] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [nonce, setNonce] = useState(0);
  const reload = () => setNonce((n) => n + 1);

  useEffect(() => {
    let alive = true;
    port.base().then((b) => { if (alive) { setBase(b); setMonth(b.today.slice(0, 7)); setDay(b.today); } }, (e: unknown) => alive && setError(e));
    return () => { alive = false; };
  }, [port]);
  useEffect(() => {
    if (!base || !month || !day) return;
    let alive = true;
    Promise.all([port.categories(), port.statement(month), port.entries(month), port.payables(addDays(base.today, -31), addDays(base.today, 90)), port.reconciliation(day)])
      .then(([c, s, en, p, r]) => {
        if (!alive) return;
        setCategories(c); setSt(s); setEntries(en); setPays(p); setRows(r); setError(null);
      }, (e: unknown) => alive && setError(e));
    return () => { alive = false; };
  }, [port, base, month, day, nonce]);

  return (
    <div className="tn-acc">
      <PageHeader id="acc-title" title="Contas"
        actions={base && !composing ? <Button onClick={() => { setTab("payables"); setComposing(true); }}><Icon name="mais" size={20} />Nova conta</Button> : null} />
      <Help><p>Contas a pagar com vencimento, pagas e estornadas; categorias de receita e despesa; conferência dos recebimentos com o extrato; e o caixa do mês, com o que entrou, saiu e sobrou e o que ainda falta lançar. Pagar lança uma despesa no Caixa uma vez só.</p></Help>
      {port.kind === "demo" ? <StatusBanner tone="info"><strong>Demonstração.</strong> Contas e lançamentos de exemplo; nada sai do seu banco.</StatusBanner> : null}
      {error ? <StatusBanner tone="danger">{explain(error)}</StatusBanner> : null}
      <Segmented label="Ver" hideLabel value={tab} onChange={setTab}
        options={[{ value: "month", label: "Mês" }, { value: "payables", label: "A pagar" }, { value: "reconcile", label: "Conferir" }, { value: "categories", label: "Categorias" }]} />

      {tab === "month" && base ? (
        <>
          <Field label="Mês" type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
          {st ? <StatementView st={st} entries={entries} categories={categories} port={port} onChange={reload} /> : null}
        </>
      ) : null}

      {tab === "payables" && base ? (
        <>
          {composing ? (
            <Card aria-labelledby="acc-new-title">
              <h2 id="acc-new-title">Nova conta a pagar</h2>
              <PayableForm port={port} base={base} categories={categories} onDone={() => { setComposing(false); reload(); }} />
              <div className="tn-actions"><Button variant="ghost" onClick={() => setComposing(false)}>Fechar</Button></div>
            </Card>
          ) : null}
          <Card aria-labelledby="acc-pay-title">
            <h2 id="acc-pay-title">A pagar</h2>
            <p className="tn-muted">Vencidas e as dos próximos 90 dias.</p>
            {pays && pays.payables.length === 0 ? <p className="tn-muted">Nenhuma conta. Crie a primeira em “Nova conta”.</p> : null}
            <ul className="tn-acc-list" aria-label="Contas a pagar">
              {pays?.payables.map((p) => <PayableRow key={`${p.id}:${p.version}`} p={p} port={port} onChange={reload} />)}
            </ul>
          </Card>
          {pays?.series.length ? (
            <Card aria-labelledby="acc-series-title">
              <h2 id="acc-series-title">Contas de todo mês</h2>
              <ul className="tn-acc-list" aria-label="Contas mensais">
                {pays.series.map((s) => <SeriesRow key={`${s.id}:${s.version}`} s={s} port={port} onChange={reload} />)}
              </ul>
            </Card>
          ) : null}
        </>
      ) : null}

      {tab === "reconcile" && base ? (
        <Card aria-labelledby="acc-rec-title">
          <h2 id="acc-rec-title">Conferir recebimentos</h2>
          <p className="tn-muted">Compare o que entrou em cada meio com o extrato do banco, da maquininha ou do provedor. A última conferência vale.</p>
          <Field label="Dia" type="date" value={day} max={base.today} onChange={(e) => e.target.value && setDay(e.target.value)} />
          {rows && rows.length === 0 ? <p className="tn-muted">Nenhum recebimento registrado neste dia.</p> : null}
          <ul className="tn-acc-list" aria-label="Recebimentos por meio">
            {rows?.map((r) => <ReconcileRow key={`${r.source}:${r.method}`} r={r} day={day} port={port} onChange={reload} />)}
          </ul>
        </Card>
      ) : null}

      {tab === "categories" ? (
        <Card aria-labelledby="acc-cat-title">
          <h2 id="acc-cat-title">Categorias</h2>
          <p className="tn-muted">As do Caixa valem sempre ({EXPENSE_BASES.map((b) => BASE_LABEL[b]).join(", ")}; e, nas entradas, atendimentos, pacotes e outras). Crie as suas para separar melhor.</p>
          <ul className="tn-acc-list" aria-label="Suas categorias">
            {categories.map((c) => <li key={c.id} className="tn-acc-item"><strong>{c.name}</strong> · {c.kind === "income" ? "receita" : `despesa (no Caixa: ${BASE_LABEL[c.base ?? "other"]})`}</li>)}
          </ul>
          <CategoryForm port={port} onDone={reload} />
        </Card>
      ) : null}
    </div>
  );
}
