// Assinaturas (P20): planos do profissional e assinaturas das clientes. O que a tela promete é o que o banco garante:
// termos congelados na adesão; cada ciclo abre um pacote de sessões e uma cobrança pelo preço aceito; mudar o plano
// não muda quem já assina; cancelar preserva o aceito e o saldo do ciclo. Assinar não é receber: a cobrança é do Caixa.
import { type FormEvent, useEffect, useState } from "react";
import { Button, Card, ConfirmAction, Field, Help, PageHeader, StatusBanner, toast, useFormErrors } from "../../components/ui/index.tsx";
import { Icon } from "../../components/ui/icons.tsx";
import { cycleLabel, explain, formatCents, formatDate, RECEIVABLE_STATUS } from "./labels.ts";
import { newKey, type RecurrenceBase, type RecurrenceCycle, type RecurrencePlan, type RecurrencePort, type RecurrenceSubscription } from "./port.ts";

const centsToInput = (c: number) => (c / 100).toFixed(2).replace(".", ",");
const parseBRL = (v: string) => Math.round(Number(v.replace(/\./g, "").replace(",", ".")) * 100);
/** Erro de ação de um toque numa linha: aviso curto, sempre à vista. */
const fail = (err: unknown) => toast({ tone: "danger", message: explain(err) });

function PlanForm({ port, base, plan, onDone }: { port: RecurrencePort; base: RecurrenceBase; plan: RecurrencePlan | null; onDone: () => void }) {
  const [name, setName] = useState(plan?.name ?? "");
  const [serviceId, setServiceId] = useState(plan?.service_id ?? base.services[0]?.id ?? "");
  const [sessions, setSessions] = useState(String(plan?.sessions_per_cycle ?? 4));
  const [cycle, setCycle] = useState<7 | 14 | 30>(plan?.cycle_days ?? 30);
  const [price, setPrice] = useState(plan ? centsToInput(plan.price_cents) : "");
  const [active, setActive] = useState(plan?.active ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { formRef, errors, show } = useFormErrors<"name" | "sessions" | "price">();
  async function submit(e: FormEvent) {
    e.preventDefault();
    const n = Number(sessions);
    const cents = parseBRL(price || "0");
    const ok = show({
      name: !name.trim() && "Informe o nome do plano.",
      sessions: (!Number.isInteger(n) || n < 1 || n > 31) && "Informe de 1 a 31 sessões.",
      price: !(cents > 0) && "Informe o preço por ciclo.",
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await port.savePlan({ plan_id: plan?.id ?? null, expected_version: plan?.version ?? null, service_id: serviceId, name: name.trim(), sessions_per_cycle: n, cycle_days: cycle, price_cents: cents, active }, newKey());
      toast(plan ? `Plano “${saved.name}” atualizado. Quem já assina mantém os termos aceitos.` : `Plano “${saved.name}” criado.`);
      if (!plan) { setName(""); setPrice(""); }
      onDone();
    } catch (err) {
      setError(explain(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form ref={formRef} className="tn-rc-form" aria-label={plan ? `Editar ${plan.name}` : "Novo plano"} onSubmit={(e) => void submit(e)} noValidate>
      <Field label="Nome do plano" maxLength={80} value={name} error={errors.name} onChange={(e) => setName(e.target.value)} />
      <Field as="select" label="Serviço" value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
        {base.services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </Field>
      <Field label="Sessões por ciclo" inputMode="numeric" value={sessions} error={errors.sessions} onChange={(e) => setSessions(e.target.value)} />
      <Field as="select" label="Ciclo" value={cycle} onChange={(e) => setCycle(Number(e.target.value) as 7 | 14 | 30)}>
        <option value={7}>7 dias</option>
        <option value={14}>14 dias</option>
        <option value={30}>30 dias</option>
      </Field>
      <Field label="Preço por ciclo (R$)" inputMode="decimal" value={price} error={errors.price} onChange={(e) => setPrice(e.target.value)} />
      <label className="tn-rc-check"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Aceita adesões</label>
      <Button type="submit" variant={plan ? "secondary" : "primary"} loading={busy}>{plan ? "Salvar plano" : "Criar plano"}</Button>
      {error ? <StatusBanner tone="danger">{error}</StatusBanner> : null}
    </form>
  );
}

function SubscribeForm({ port, base, plans, onDone }: { port: RecurrencePort; base: RecurrenceBase; plans: RecurrencePlan[]; onDone: () => void }) {
  const active = plans.filter((p) => p.active);
  const [planId, setPlanId] = useState(active[0]?.id ?? "");
  const [customerId, setCustomerId] = useState(base.customers[0]?.id ?? "");
  const [accepted, setAccepted] = useState(false);
  const [key, setKey] = useState(newKey);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { formRef, errors, show } = useFormErrors<"plan" | "customer" | "accepted">();
  const plan = active.find((p) => p.id === planId) ?? active[0];
  async function submit(e: FormEvent) {
    e.preventDefault();
    const ok = show({
      plan: !plan && "Crie um plano ativo antes.",
      customer: !customerId && "Escolha a cliente.",
      accepted: !accepted && "Confirme que a cliente aceitou estes termos.",
    });
    if (!ok || !plan) return;
    setBusy(true);
    setError(null);
    try {
      const s = await port.subscribe(plan.id, customerId, key);
      setKey(newKey());
      setAccepted(false);
      toast(`${s.customer_name} assinou “${s.terms.plan_name}”: ${s.terms.sessions_per_cycle} sessões ${cycleLabel(s.terms.cycle_days)} por ${formatCents(s.terms.price_cents)}. Primeiro ciclo aberto com cobrança em aberto no Caixa.`);
      onDone();
    } catch (err) {
      setKey(newKey());
      setError(explain(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form ref={formRef} className="tn-rc-form" aria-label="Nova assinatura" onSubmit={(e) => void submit(e)} noValidate>
      <Field as="select" label="Plano" value={plan?.id ?? ""} error={errors.plan} onChange={(e) => setPlanId(e.target.value)} disabled={active.length === 0}>
        {active.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.sessions_per_cycle} × {p.service_name} {cycleLabel(p.cycle_days)} · {formatCents(p.price_cents)}</option>)}
      </Field>
      <Field as="select" label="Cliente" value={customerId} error={errors.customer} onChange={(e) => setCustomerId(e.target.value)}>
        {base.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </Field>
      <div className="tn-rc-accept">
        <label className="tn-rc-check">
          <input type="checkbox" checked={accepted} aria-invalid={errors.accepted ? true : undefined} aria-describedby={errors.accepted ? "rc-accept-error" : undefined}
            onChange={(e) => setAccepted(e.target.checked)} /> A cliente aceitou estes termos comigo (adesão declarada)
        </label>
        {errors.accepted ? <span id="rc-accept-error" className="tn-field__error">{errors.accepted}</span> : null}
      </div>
      <Button type="submit" loading={busy}>Registrar adesão</Button>
      {error ? <StatusBanner tone="danger">{error}</StatusBanner> : null}
    </form>
  );
}

function SubscriptionItem({ sub, port, timezone, onDone }: { sub: RecurrenceSubscription; port: RecurrencePort; timezone: string; onDone: () => void }) {
  const [history, setHistory] = useState<RecurrenceCycle[] | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<"end" | "resume" | null>(null);
  const who = sub.customer_name ?? "cliente";
  const c = sub.current_cycle;

  async function resume(s: RecurrenceSubscription, message: string) {
    try {
      await port.resume(s, newKey());
      toast(message);
    } catch (err) {
      fail(err);
    } finally {
      onDone();
    }
  }
  // Parar de renovar volta atrás com "Manter assinatura" (resume): executa e oferece Desfazer.
  async function cancelAtEnd() {
    setBusy("end");
    try {
      const updated = await port.cancel(sub, true, reason.trim() || null, newKey());
      toast({
        message: "A assinatura segue até o fim do ciclo e não renova. Saldo e termos preservados.",
        action: { label: "Desfazer", onAction: () => resume(updated, "Pronto: a assinatura volta a renovar.") },
      });
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
      onDone();
    }
  }
  async function keep() {
    setBusy("resume");
    await resume(sub, "Cancelamento desfeito: a assinatura volta a renovar.");
    setBusy(null);
  }
  async function cancelNow() {
    try {
      await port.cancel(sub, false, reason.trim() || null, newKey());
      toast("Assinatura encerrada agora. As sessões do ciclo atual continuam válidas até o fim dele.");
      onDone();
    } catch (err) {
      fail(err);
      onDone();
      throw err;
    }
  }

  return (
    <li className="tn-rc-item">
      <h3>{who} · {sub.terms.plan_name}</h3>
      <p>
        <strong>{sub.status === "active" ? (sub.cancel_at_period_end ? "Ativa, não renova no fim do ciclo" : "Ativa") : "Cancelada"}</strong>
        {" · "}{sub.terms.sessions_per_cycle} × {sub.terms.service_name ?? "sessão"} {cycleLabel(sub.terms.cycle_days)} por {formatCents(sub.terms.price_cents)} (termos aceitos em {formatDate(sub.accepted_at, timezone)})
      </p>
      {c ? (
        <p className="tn-muted">
          Ciclo {c.cycle_no}: {formatDate(c.starts_at, timezone)} a {formatDate(c.ends_at, timezone)} · {c.package.remaining_credits} de {c.package.purchased_credits} sessões restantes · {RECEIVABLE_STATUS[c.receivable.status]} ({formatCents(c.receivable.amount_cents)})
          {sub.next_renewal_at && sub.status === "active" && !sub.cancel_at_period_end ? ` · renova em ${formatDate(sub.next_renewal_at, timezone)}` : ""}
        </p>
      ) : null}
      <div className="tn-actions">
        {sub.status === "active" && !sub.cancel_at_period_end ? (
          <>
            <Field label="Motivo (opcional)" className="tn-rc-reason" maxLength={280} value={reason} onChange={(e) => setReason(e.target.value)} />
            <Button variant="secondary" loading={busy === "end"} onClick={() => void cancelAtEnd()}>Cancelar no fim do ciclo</Button>
            <ConfirmAction
              trigger="Cancelar agora"
              triggerLabel={`Cancelar agora a assinatura de ${who}`}
              title={`Encerrar a assinatura de ${who} agora?`}
              consequence={
                <p>
                  {sub.customer_name ?? "A cliente"} deixa de assinar hoje e nada mais renova.
                  {c ? ` ${c.package.remaining_credits === 1 ? "A sessão restante do ciclo atual continua" : `As ${c.package.remaining_credits} sessões restantes do ciclo atual continuam`} valendo até ${formatDate(c.ends_at, timezone)}, e a cobrança deste ciclo (${formatCents(c.receivable.amount_cents)}) continua no Caixa.` : ""}
                  {" "}Para desfazer, será preciso uma nova adesão. Se quiser só parar de renovar, use “Cancelar no fim do ciclo”.
                </p>
              }
              confirmLabel="Sim, encerrar agora"
              onConfirm={cancelNow}
            />
          </>
        ) : null}
        {sub.status === "active" && sub.cancel_at_period_end ? (
          <Button variant="secondary" loading={busy === "resume"} onClick={() => void keep()}>Manter assinatura</Button>
        ) : null}
        <Button variant="ghost" onClick={() => void port.cycles(sub.id).then(setHistory, fail)}>Ver ciclos</Button>
      </div>
      {history ? (
        <ul className="tn-rc-list" aria-label={`Ciclos de ${who}`}>
          {history.map((h) => <li key={h.id}>Ciclo {h.cycle_no} · {formatDate(h.starts_at, timezone)} a {formatDate(h.ends_at, timezone)} · {h.package.remaining_credits}/{h.package.purchased_credits} sessões · {RECEIVABLE_STATUS[h.receivable.status]}</li>)}
        </ul>
      ) : null}
    </li>
  );
}

export function RecurrencePage({ port }: { port: RecurrencePort }) {
  const [base, setBase] = useState<RecurrenceBase | null>(null);
  const [plans, setPlans] = useState<RecurrencePlan[]>([]);
  const [subs, setSubs] = useState<RecurrenceSubscription[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  // Lista primeiro: cada formulário abre pelo seu botão e fecha ao concluir.
  const [open, setOpen] = useState<"plan" | "sub" | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [nonce, setNonce] = useState(0);
  const [ticking, setTicking] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.all([port.base(), port.plans(), port.subscriptions()]).then(([b, p, s]) => {
      if (!alive) return;
      setBase(b);
      setPlans(p);
      setSubs(s);
      setError(null);
    }, (e: unknown) => alive && setError(e ?? new Error("erro")));
    return () => { alive = false; };
  }, [port, nonce]);
  const reload = () => setNonce((x) => x + 1);
  /** Formulário concluído: fecha e atualiza. */
  const saved = () => {
    setEditing(null);
    setOpen(null);
    reload();
  };
  async function tick() {
    setTicking(true);
    try {
      const r = await port.tick!();
      toast({ tone: "info", message: `Renovação (simulação): ${r.renewed} ciclo(s) aberto(s), ${r.closed} assinatura(s) encerrada(s).` });
    } catch (err) {
      fail(err);
    } finally {
      setTicking(false);
      reload();
    }
  }
  const timezone = base?.timezone ?? "America/Sao_Paulo";

  return (
    <div className="tn-rc">
      <PageHeader
        id="rc-title"
        title="Assinaturas"
        actions={base && plans.some((p) => p.active) && open !== "sub" ? (
          <Button onClick={() => setOpen("sub")}>
            <Icon name="mais" size={20} />
            Nova assinatura
          </Button>
        ) : null}
      />
      <Help><p>Planos do seu negócio (ex.: 4 cortes por mês) e as clientes que assinam. Cada ciclo abre as sessões e uma cobrança pelo preço aceito; o Caixa recebe (por Pix ou registro manual). Mudar um plano não muda quem já assina; cancelar preserva o que foi aceito e o saldo do ciclo.</p></Help>
      {port.kind === "demo" ? <StatusBanner tone="info"><strong>Demonstração.</strong> Dados de exemplo; nada é cobrado. "Avançar o ciclo" simula a renovação que o sistema faz sozinho.</StatusBanner> : null}
      {error ? <StatusBanner tone="danger">{explain(error)}</StatusBanner> : null}

      {open === "sub" && base ? (
        <Card aria-labelledby="rc-new-sub-title">
          <h2 id="rc-new-sub-title">Nova assinatura</h2>
          <SubscribeForm key={`sub:${nonce}`} port={port} base={base} plans={plans} onDone={saved} />
          <div className="tn-actions"><Button variant="ghost" onClick={() => setOpen(null)}>Fechar</Button></div>
        </Card>
      ) : null}

      <Card aria-labelledby="rc-plans-title">
        <div className="tn-rc-head">
          <h2 id="rc-plans-title">Planos</h2>
          {base && open !== "plan" ? <Button variant="secondary" onClick={() => setOpen("plan")}><Icon name="mais" size={20} />Novo plano</Button> : null}
        </div>
        {open === "plan" && base ? (
          <div className="tn-rc-new">
            <PlanForm key={`new:${nonce}`} port={port} base={base} plan={null} onDone={saved} />
            <div className="tn-actions"><Button variant="ghost" onClick={() => setOpen(null)}>Fechar</Button></div>
          </div>
        ) : null}
        {plans.length === 0 ? <p className="tn-muted">Nenhum plano ainda. Crie o primeiro em “Novo plano”.</p> : null}
        <ul className="tn-rc-list" aria-label="Planos cadastrados">
          {plans.map((p) => (
            <li key={p.id} className="tn-rc-item">
              <h3>{p.name}{p.active ? "" : " (inativo)"}</h3>
              <p>{p.sessions_per_cycle} × {p.service_name ?? "sessão"} {cycleLabel(p.cycle_days)} · {formatCents(p.price_cents)} · {p.subscribers} assinante(s)</p>
              <div className="tn-actions"><Button variant="ghost" onClick={() => setEditing(editing === p.id ? null : p.id)}>{editing === p.id ? "Fechar" : "Editar"}</Button></div>
              {editing === p.id && base ? <PlanForm port={port} base={base} plan={p} onDone={saved} /> : null}
            </li>
          ))}
        </ul>
      </Card>

      <Card aria-labelledby="rc-subs-title">
        <h2 id="rc-subs-title">Assinantes</h2>
        {base && !plans.some((p) => p.active) ? <p className="tn-muted">Crie um plano ativo para registrar adesões.</p> : null}
        {subs && subs.length === 0 ? <p className="tn-muted">Nenhuma assinatura ainda.</p> : null}
        <ul className="tn-rc-list" aria-label="Assinaturas">
          {subs?.map((s) => <SubscriptionItem key={s.id} sub={s} port={port} timezone={timezone} onDone={reload} />)}
        </ul>
      </Card>
      {port.tick ? <div className="tn-actions"><Button variant="secondary" loading={ticking} onClick={() => void tick()}>Avançar o ciclo (simulação)</Button></div> : null}
    </div>
  );
}
