// Assinaturas (P20): planos do profissional e assinaturas das clientes. O que a tela promete é o que o banco garante:
// termos congelados na adesão; cada ciclo abre um pacote de sessões e uma cobrança pelo preço aceito; mudar o plano
// não muda quem já assina; cancelar preserva o aceito e o saldo do ciclo. Assinar não é receber: a cobrança é do Caixa.
import { type FormEvent, useEffect, useState } from "react";
import { Button, Card, Help, PageHeader, StatusBanner } from "../../components/ui/index.tsx";
import { Icon } from "../../components/ui/icons.tsx";
import { cycleLabel, explain, formatCents, formatDate, RECEIVABLE_STATUS } from "./labels.ts";
import { newKey, type RecurrenceBase, type RecurrenceCycle, type RecurrencePlan, type RecurrencePort, type RecurrenceSubscription } from "./port.ts";

type Notice = { tone: "success" | "danger" | "info" | "warning"; text: string } | null;
const centsToInput = (c: number) => (c / 100).toFixed(2).replace(".", ",");
const parseBRL = (v: string) => Math.round(Number(v.replace(/\./g, "").replace(",", ".")) * 100);

function PlanForm({ port, base, plan, onDone }: { port: RecurrencePort; base: RecurrenceBase; plan: RecurrencePlan | null; onDone: (n: Notice) => void }) {
  const [name, setName] = useState(plan?.name ?? "");
  const [serviceId, setServiceId] = useState(plan?.service_id ?? base.services[0]?.id ?? "");
  const [sessions, setSessions] = useState(String(plan?.sessions_per_cycle ?? 4));
  const [cycle, setCycle] = useState<7 | 14 | 30>(plan?.cycle_days ?? 30);
  const [price, setPrice] = useState(plan ? centsToInput(plan.price_cents) : "");
  const [active, setActive] = useState(plan?.active ?? true);
  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      const saved = await port.savePlan({ plan_id: plan?.id ?? null, expected_version: plan?.version ?? null, service_id: serviceId, name: name.trim(), sessions_per_cycle: Number(sessions), cycle_days: cycle, price_cents: parseBRL(price), active }, newKey());
      onDone({ tone: "success", text: plan ? `Plano “${saved.name}” atualizado. Quem já assina mantém os termos aceitos.` : `Plano “${saved.name}” criado.` });
      if (!plan) { setName(""); setPrice(""); }
    } catch (err) {
      onDone({ tone: "danger", text: explain(err) });
    }
  }
  return (
    <form className="tn-rc-form" aria-label={plan ? `Editar ${plan.name}` : "Novo plano"} onSubmit={(e) => void submit(e)}>
      <label className="tn-rc-field">Nome do plano
        <input maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="tn-rc-field">Serviço
        <select value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
          {base.services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </label>
      <label className="tn-rc-field">Sessões por ciclo
        <input inputMode="numeric" value={sessions} onChange={(e) => setSessions(e.target.value)} />
      </label>
      <label className="tn-rc-field">Ciclo
        <select value={cycle} onChange={(e) => setCycle(Number(e.target.value) as 7 | 14 | 30)}>
          <option value={7}>7 dias</option>
          <option value={14}>14 dias</option>
          <option value={30}>30 dias</option>
        </select>
      </label>
      <label className="tn-rc-field">Preço por ciclo (R$)
        <input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
      </label>
      <label className="tn-rc-check"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Aceita adesões</label>
      <Button type="submit" variant={plan ? "secondary" : "primary"} disabled={!name.trim() || !(parseBRL(price || "0") > 0)}>{plan ? "Salvar plano" : "Criar plano"}</Button>
    </form>
  );
}

function SubscribeForm({ port, base, plans, onDone }: { port: RecurrencePort; base: RecurrenceBase; plans: RecurrencePlan[]; onDone: (n: Notice) => void }) {
  const active = plans.filter((p) => p.active);
  const [planId, setPlanId] = useState(active[0]?.id ?? "");
  const [customerId, setCustomerId] = useState(base.customers[0]?.id ?? "");
  const [accepted, setAccepted] = useState(false);
  const [key, setKey] = useState(newKey);
  const plan = active.find((p) => p.id === planId) ?? active[0];
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!plan) return;
    try {
      const s = await port.subscribe(plan.id, customerId, key);
      setKey(newKey());
      setAccepted(false);
      onDone({ tone: "success", text: `${s.customer_name} assinou “${s.terms.plan_name}”: ${s.terms.sessions_per_cycle} sessões ${cycleLabel(s.terms.cycle_days)} por ${formatCents(s.terms.price_cents)}. Primeiro ciclo aberto com cobrança em aberto no Caixa.` });
    } catch (err) {
      setKey(newKey());
      onDone({ tone: "danger", text: explain(err) });
    }
  }
  return (
    <form className="tn-rc-form" aria-label="Nova assinatura" onSubmit={(e) => void submit(e)}>
      <label className="tn-rc-field">Plano
        <select value={plan?.id ?? ""} onChange={(e) => setPlanId(e.target.value)} disabled={active.length === 0}>
          {active.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.sessions_per_cycle} × {p.service_name} {cycleLabel(p.cycle_days)} · {formatCents(p.price_cents)}</option>)}
        </select>
      </label>
      <label className="tn-rc-field">Cliente
        <select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
          {base.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
      <label className="tn-rc-check"><input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} /> A cliente aceitou estes termos comigo (adesão declarada)</label>
      <Button type="submit" disabled={!plan || !customerId || !accepted}>Registrar adesão</Button>
    </form>
  );
}

function SubscriptionItem({ sub, port, timezone, onDone }: { sub: RecurrenceSubscription; port: RecurrencePort; timezone: string; onDone: (n: Notice) => void }) {
  const [history, setHistory] = useState<RecurrenceCycle[] | null>(null);
  const [reason, setReason] = useState("");
  const act = (run: () => Promise<unknown>, ok: string) => run().then(() => onDone({ tone: "success", text: ok }), (e: unknown) => onDone({ tone: "danger", text: explain(e) }));
  const c = sub.current_cycle;
  return (
    <li className="tn-rc-item">
      <h3>{sub.customer_name ?? "cliente"} · {sub.terms.plan_name}</h3>
      <p>
        <strong>{sub.status === "active" ? (sub.cancel_at_period_end ? "Ativa, não renova no fim do ciclo" : "Ativa") : "Cancelada"}</strong>
        {" · "}{sub.terms.sessions_per_cycle} × {sub.terms.service_name ?? "sessão"} {cycleLabel(sub.terms.cycle_days)} por {formatCents(sub.terms.price_cents)} (termos aceitos em {formatDate(sub.accepted_at, timezone)})
      </p>
      {c ? (
        <p className="tn-rc-muted">
          Ciclo {c.cycle_no}: {formatDate(c.starts_at, timezone)} a {formatDate(c.ends_at, timezone)} · {c.package.remaining_credits} de {c.package.purchased_credits} sessões restantes · {RECEIVABLE_STATUS[c.receivable.status]} ({formatCents(c.receivable.amount_cents)})
          {sub.next_renewal_at && sub.status === "active" && !sub.cancel_at_period_end ? ` · renova em ${formatDate(sub.next_renewal_at, timezone)}` : ""}
        </p>
      ) : null}
      <div className="tn-rc-actions">
        {sub.status === "active" && !sub.cancel_at_period_end ? (
          <>
            <label className="tn-rc-field" style={{ flex: "1 1 12rem" }}>Motivo (opcional)
              <input maxLength={280} value={reason} onChange={(e) => setReason(e.target.value)} />
            </label>
            <Button variant="secondary" onClick={() => void act(() => port.cancel(sub, true, reason.trim() || null, newKey()), "A assinatura segue até o fim do ciclo e não renova. Saldo e termos preservados.")}>Cancelar no fim do ciclo</Button>
            <Button variant="ghost" onClick={() => void act(() => port.cancel(sub, false, reason.trim() || null, newKey()), "Assinatura encerrada agora. As sessões do ciclo atual continuam válidas até o fim dele.")}>Cancelar agora</Button>
          </>
        ) : null}
        {sub.status === "active" && sub.cancel_at_period_end ? (
          <Button variant="secondary" onClick={() => void act(() => port.resume(sub, newKey()), "Cancelamento desfeito: a assinatura volta a renovar.")}>Manter assinatura</Button>
        ) : null}
        <Button variant="ghost" onClick={() => void port.cycles(sub.id).then(setHistory, (e: unknown) => onDone({ tone: "danger", text: explain(e) }))}>Ver ciclos</Button>
      </div>
      {history ? (
        <ul className="tn-rc-list" aria-label={`Ciclos de ${sub.customer_name ?? "cliente"}`}>
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
  const [notice, setNotice] = useState<Notice>(null);
  const [error, setError] = useState<unknown>(null);
  const [nonce, setNonce] = useState(0);

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
  const done = (n: Notice) => {
    setNotice(n);
    setEditing(null);
    if (n?.tone === "success") setOpen(null);
    setNonce((x) => x + 1);
  };
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
      <Help><p>Planos do seu negócio (ex.: 4 cortes por mês) e as clientes que assinam. Cada ciclo abre as sessões e uma cobrança pelo preço aceito; o Caixa recebe (Pix pelo provedor ou manual). Mudar um plano não muda quem já assina; cancelar preserva o que foi aceito e o saldo do ciclo.</p></Help>
      {port.kind === "demo" ? <StatusBanner tone="info"><strong>Demonstração.</strong> Dados de exemplo; nada é cobrado. "Avançar o ciclo" simula a renovação pelo worker.</StatusBanner> : null}
      {error ? <StatusBanner tone="danger">{explain(error)}</StatusBanner> : null}
      {notice ? <StatusBanner tone={notice.tone}>{notice.text}</StatusBanner> : null}

      {open === "sub" && base ? (
        <Card aria-labelledby="rc-new-sub-title">
          <h2 id="rc-new-sub-title">Nova assinatura</h2>
          <SubscribeForm key={`sub:${nonce}`} port={port} base={base} plans={plans} onDone={done} />
          <div className="tn-rc-actions"><Button variant="ghost" onClick={() => setOpen(null)}>Fechar</Button></div>
        </Card>
      ) : null}

      <Card aria-labelledby="rc-plans-title">
        <div className="tn-rc-head">
          <h2 id="rc-plans-title">Planos</h2>
          {base && open !== "plan" ? <Button variant="secondary" onClick={() => setOpen("plan")}><Icon name="mais" size={20} />Novo plano</Button> : null}
        </div>
        {open === "plan" && base ? (
          <div className="tn-rc-new">
            <PlanForm key={`new:${nonce}`} port={port} base={base} plan={null} onDone={done} />
            <div className="tn-rc-actions"><Button variant="ghost" onClick={() => setOpen(null)}>Fechar</Button></div>
          </div>
        ) : null}
        {plans.length === 0 ? <p className="tn-rc-muted">Nenhum plano ainda. Crie o primeiro em “Novo plano”.</p> : null}
        <ul className="tn-rc-list" aria-label="Planos cadastrados">
          {plans.map((p) => (
            <li key={p.id} className="tn-rc-item">
              <h3>{p.name}{p.active ? "" : " (inativo)"}</h3>
              <p>{p.sessions_per_cycle} × {p.service_name ?? "sessão"} {cycleLabel(p.cycle_days)} · {formatCents(p.price_cents)} · {p.subscribers} assinante(s)</p>
              <div className="tn-rc-actions"><Button variant="ghost" onClick={() => setEditing(editing === p.id ? null : p.id)}>{editing === p.id ? "Fechar" : "Editar"}</Button></div>
              {editing === p.id && base ? <PlanForm port={port} base={base} plan={p} onDone={done} /> : null}
            </li>
          ))}
        </ul>
      </Card>

      <Card aria-labelledby="rc-subs-title">
        <h2 id="rc-subs-title">Assinantes</h2>
        {base && !plans.some((p) => p.active) ? <p className="tn-rc-muted">Crie um plano ativo para registrar adesões.</p> : null}
        {subs && subs.length === 0 ? <p className="tn-rc-muted">Nenhuma assinatura ainda.</p> : null}
        <ul className="tn-rc-list" aria-label="Assinaturas">
          {subs?.map((s) => <SubscriptionItem key={s.id} sub={s} port={port} timezone={timezone} onDone={done} />)}
        </ul>
      </Card>
      {port.tick ? <div className="tn-rc-actions"><Button variant="secondary" onClick={() => void port.tick!().then((r) => done({ tone: "info", text: `Renovação (simulação): ${r.renewed} ciclo(s) aberto(s), ${r.closed} assinatura(s) encerrada(s).` }))}>Avançar o ciclo (simulação)</Button></div> : null}
    </div>
  );
}
