// "Registrar" (item 56, P48): o painel que abre no lugar, logo abaixo do cabeçalho, e os quatro formulários de lançamento
// (Recebi, Despesa, A receber, Pacote). "Vender pacote" da opção Pacotes usa o mesmo formulário.
import { type FormEvent, useEffect, useRef, useState } from "react";
import type { ExpenseCategory } from "@contracts";
import { Button, Field, Segmented, StatusBanner, useFormErrors } from "../../components/ui/index.tsx";
import { useAttemptValue, useIdempotencyKey } from "../../lib/idempotency.ts";
import { METHOD_LABEL, type Method } from "../../lib/collect.ts";
import { endOfLocalDay, formatCents, noonOfLocalDay, parseBRL } from "./money.ts";
import { CATEGORY_LABEL, explain, MethodField, usePage, usePort } from "./shared.tsx";

// "Registrar" abre em "Recebi" (P48): o lançamento mais comum é o dinheiro que entrou agora.
export type RegisterKind = "receipt" | "expense" | "receivable" | "package";
const REGISTER_OPTIONS: readonly { value: RegisterKind; label: string }[] = [
  { value: "receipt", label: "Recebi" },
  { value: "expense", label: "Despesa" },
  { value: "receivable", label: "A receber" },
  { value: "package", label: "Pacote" },
];

/** Painel "Registrar": escolhe o que lançar e abre o formulário no lugar, com o foco no primeiro campo. */
export function RegisterPanel({ kind, onKind, onClose }: { kind: RegisterKind; onKind: (k: RegisterKind) => void; onClose: () => void }) {
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    panel.current?.querySelector<HTMLElement>("form input, form select, form textarea")?.focus();
  }, []);
  return (
    <section ref={panel} id="fin-register" className="tn-card tn-fin-register" aria-labelledby="fin-reg-title">
      <h2 id="fin-reg-title">Registrar</h2>
      <Segmented label="O que registrar" value={kind} options={REGISTER_OPTIONS} onChange={onKind} />
      {kind === "receipt" ? <ReceiptForm onDone={onClose} /> : kind === "expense" ? <ExpenseForm onDone={onClose} /> : kind === "receivable" ? <ReceivableForm onDone={onClose} /> : <PackageForm onDone={onClose} />}
      <div className="tn-actions">
        <Button variant="ghost" onClick={onClose}>Fechar</Button>
      </div>
    </section>
  );
}

/**
 * "Recebi" (P48, abre primeiro no "+ Registrar"): dinheiro que entrou fora de um atendimento da agenda. Valor, forma e
 * cliente opcional. No servidor são dois registros, como no atalho do atendimento: a cobrança e o pagamento dela.
 */
function ReceiptForm({ onDone }: { onDone: () => void }) {
  const ctx = usePage();
  const port = usePort();
  const charge = useIdempotencyKey();
  const pay = useIdempotencyKey();
  // Mesmo instante na nova tentativa (ver ReceivableItem): senão o recebimento seria gravado duas vezes.
  const instant = useAttemptValue<string>();
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<Method>("pix");
  const [customer, setCustomer] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const { formRef, errors, show } = useFormErrors<"amount">();

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const cents = parseBRL(amount);
    if (!show({ amount: !cents && "Informe o valor recebido." }) || !cents) return;
    const receivable = { description: "Recebimento avulso", amount_cents: cents, customer_id: customer || null };
    setPending(true);
    setError(null);
    try {
      const r = await port.createReceivable(receivable, charge.keyFor(receivable));
      const payment = {
        receivable_id: r.id, amount_cents: cents, method,
        received_at: instant.valueFor({ receivable, method }, () => port.now().toISOString()),
      };
      await port.recordPayment(payment, pay.keyFor(payment));
      charge.reset();
      pay.reset();
      instant.reset();
      ctx.notify("success", `Recebimento de ${formatCents(cents)} registrado (${METHOD_LABEL[method]}, manual).`);
      onDone();
      ctx.reload();
    } catch (err) {
      setError(explain(err));
      setPending(false);
    }
  }

  return (
    <form ref={formRef} className="tn-fin-form" onSubmit={(e) => void submit(e)} noValidate aria-label="Novo recebimento">
      <Field label="Valor recebido (R$)" id="rcp-amount" inputMode="decimal" value={amount} error={errors.amount} onChange={(e) => setAmount(e.target.value)} />
      <MethodField id="rcp-method" value={method} onChange={setMethod} />
      <Field as="select" label="Cliente (opcional)" id="rcp-customer" value={customer} onChange={(e) => setCustomer(e.target.value)}>
        <option value="">Sem cliente</option>
        {ctx.base.customers.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </Field>
      {error ? <StatusBanner tone="danger">{error}</StatusBanner> : null}
      <Button type="submit" loading={pending}>Salvar recebimento</Button>
    </form>
  );
}

/** Despesa (abre pelo "+ Registrar"). */
function ExpenseForm({ onDone }: { onDone: () => void }) {
  const ctx = usePage();
  const port = usePort();
  const { keyFor, reset: resetKey } = useIdempotencyKey();
  // Mesmo instante na nova tentativa (ver ReceivableItem): senão a despesa seria gravada duas vezes.
  const instant = useAttemptValue<string>();
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
    const text = description.trim() || null;
    const payload = {
      amount_cents: cents, category, description: text,
      paid_at: date === ctx.today
        ? instant.valueFor({ cents, category, text, date }, () => port.now().toISOString())
        : noonOfLocalDay(date, ctx.base.timezone),
    };
    setPending(true);
    setError(null);
    try {
      await port.recordExpense(payload, keyFor(payload));
      resetKey();
      instant.reset();
      ctx.notify("success", `Despesa de ${formatCents(cents)} registrada.`);
      onDone();
      ctx.reload();
    } catch (err) {
      setError(explain(err));
      setPending(false);
    }
  }

  return (
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
  );
}

/** Venda de pacote: no "+ Registrar" e no botão da seção de pacotes. */
export function PackageForm({ onDone }: { onDone: () => void }) {
  const ctx = usePage();
  const port = usePort();
  const { keyFor } = useIdempotencyKey();
  const active = ctx.base.services.filter((s) => s.active);
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
      onDone();
      ctx.reload();
    } catch (err) {
      setError(explain(err));
      setPending(false);
    }
  }

  return (
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
      <Button type="submit" loading={pending}>Confirmar venda</Button>
    </form>
  );
}

/** Cobrança avulsa (abre pelo "+ Registrar"): produto vendido, sinal ou valor combinado fora da agenda. */
function ReceivableForm({ onDone }: { onDone: () => void }) {
  const ctx = usePage();
  const port = usePort();
  const { keyFor } = useIdempotencyKey();
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
      onDone();
      ctx.reload();
    } catch (err) {
      setError(explain(err));
      setPending(false);
    }
  }

  return (
    <form ref={formRef} className="tn-fin-form" onSubmit={(e) => void submit(e)} noValidate aria-label="Nova cobrança">
      <p className="tn-muted tn-fin-form__note">Produto vendido, sinal ou valor combinado fora da agenda.</p>
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
  );
}
