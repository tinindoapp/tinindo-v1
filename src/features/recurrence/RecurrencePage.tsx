// Assinaturas (P20): planos do profissional e assinaturas das clientes. O que a tela promete é o que o banco garante:
// termos congelados na adesão; cada ciclo abre um pacote de sessões e uma cobrança pelo preço aceito; mudar o plano
// não muda quem já assina; cancelar preserva o aceito e o saldo do ciclo. Assinar não é receber: a cobrança é do Caixa.
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Button, CappedList, Card, Field, type MenuAction, PageHeader, Section, StatusBadge, StatusBanner, toast, useFormErrors } from "../../components/ui/index.tsx";
import { InlineConfirm, Row } from "./rows.tsx";
import { Icon } from "../../components/ui/icons.tsx";
import { cycleLabel, explain, formatCents, RECEIVABLE_STATUS } from "./labels.ts";
import { type RecurrenceBase, type RecurrenceCycle, type RecurrencePlan, type RecurrencePort, type RecurrenceSubscription } from "./port.ts";
import { useCommand, useIdempotencyKey } from "../../lib/idempotency.ts";
import { centsToInput, parseBRL } from "../../lib/money.ts";
import { plural } from "../../lib/text/plural.ts";
import { formatDate } from "../../lib/time.ts";

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
  const idem = useIdempotencyKey();
  const { formRef, errors, show } = useFormErrors<"name" | "sessions" | "price">();
  async function submit(e: FormEvent) {
    e.preventDefault();
    const n = Number(sessions);
    const cents = parseBRL(price);
    const ok = show({
      name: !name.trim() && "Informe o nome do plano.",
      sessions: (!Number.isInteger(n) || n < 1 || n > 31) && "Informe de 1 a 31 sessões.",
      price: (cents === undefined && "Use só números, por exemplo 240,00.") || ((cents === null || cents === 0) && "Informe o preço por ciclo."),
    });
    if (!ok || cents === null || cents === undefined) return;
    setBusy(true);
    setError(null);
    try {
      // Mesma chave enquanto o pedido for o mesmo: repetir depois de uma falha de rede não cria o plano duas vezes.
      const payload = { plan_id: plan?.id ?? null, expected_version: plan?.version ?? null, service_id: serviceId, name: name.trim(), sessions_per_cycle: n, cycle_days: cycle, price_cents: cents, active };
      const saved = await port.savePlan(payload, idem.keyFor(payload));
      idem.reset();
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
  const idem = useIdempotencyKey();
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
      // Mesma chave enquanto plano e cliente forem os mesmos (inclusive depois de erro): repetir não assina duas vezes.
      const s = await port.subscribe(plan.id, customerId, idem.keyFor({ plan: plan.id, customer: customerId }));
      idem.reset();
      setAccepted(false);
      toast(`${s.customer_name} assinou “${s.terms.plan_name}”: ${s.terms.sessions_per_cycle} sessões ${cycleLabel(s.terms.cycle_days)} por ${formatCents(s.terms.price_cents)}. Primeiro ciclo aberto com cobrança em aberto no Caixa.`);
      onDone();
    } catch (err) {
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

/** Parar de renovar (volta atrás com "Manter assinatura"): abre embaixo da linha com o motivo opcional. */
function EndPanel({ who, reason, onReason, busy, onEnd, onClose }: {
  who: string; reason: string; onReason: (v: string) => void; busy: boolean; onEnd: () => void; onClose: () => void;
}) {
  const heading = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  const title = `Parar de renovar a assinatura de ${who}?`;
  const back = () => {
    const menu = heading.current?.closest("li")?.querySelector<HTMLElement>(".tn-menu > button");
    onClose();
    menu?.focus();
  };
  return (
    <div className="tn-confirm" role="group" aria-label={title}>
      <p ref={heading} tabIndex={-1} className="tn-confirm__title">{title}</p>
      <div className="tn-confirm__body"><p>A assinatura segue até o fim do ciclo e não renova. Saldo e termos ficam preservados, e dá para desfazer.</p></div>
      <Field label="Motivo (opcional)" maxLength={280} value={reason} onChange={(e) => onReason(e.target.value)} />
      <div className="tn-actions">
        <Button variant="secondary" loading={busy} onClick={onEnd}>Cancelar no fim do ciclo</Button>
        <Button variant="ghost" onClick={back} disabled={busy}>Voltar</Button>
      </div>
    </div>
  );
}

function SubscriptionItem({ sub, port, timezone, onDone }: { sub: RecurrenceSubscription; port: RecurrencePort; timezone: string; onDone: () => void }) {
  const [history, setHistory] = useState<RecurrenceCycle[] | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<"end" | "resume" | null>(null);
  // O que abre embaixo da linha: parar de renovar ou encerrar agora.
  const [panel, setPanel] = useState<"end" | "now" | null>(null);
  const command = useCommand();
  const who = sub.customer_name ?? "cliente";
  const c = sub.current_cycle;
  const renewing = sub.status === "active" && !sub.cancel_at_period_end;
  const ending = sub.status === "active" && sub.cancel_at_period_end;

  async function resume(s: RecurrenceSubscription, message: string) {
    try {
      await command({ resume: s.id, version: s.version }, (key) => port.resume(s, key));
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
      const why = reason.trim() || null;
      const updated = await command({ cancelAtEnd: sub.id, version: sub.version, why }, (key) => port.cancel(sub, true, why, key));
      setPanel(null);
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
      const why = reason.trim() || null;
      await command({ cancelNow: sub.id, version: sub.version, why }, (key) => port.cancel(sub, false, why, key));
      toast("Assinatura encerrada agora. As sessões do ciclo atual continuam válidas até o fim dele.");
      onDone();
    } catch (err) {
      fail(err);
      onDone();
      throw err;
    }
  }
  const cycles = () => void port.cycles(sub.id).then(setHistory, fail);

  // Uma ação visível por linha (P54): "Manter assinatura" quando ela não vai renovar; senão, "Ver ciclos". O resto no "⋯".
  const action = ending ? (
    <Button size="compact" variant="secondary" loading={busy === "resume"} onClick={() => void keep()}>Manter assinatura</Button>
  ) : (
    <Button size="compact" variant="secondary" onClick={cycles}>Ver ciclos</Button>
  );
  const more: MenuAction[] = renewing
    ? [
        { label: "Cancelar no fim do ciclo…", onSelect: () => setPanel("end") },
        { label: "Cancelar agora…", tone: "danger", onSelect: () => setPanel("now") },
      ]
    : ending ? [{ label: "Ver ciclos", onSelect: cycles }] : [];

  return (
    <Row
      title={`${who} · ${sub.terms.plan_name}`}
      badge={
        <StatusBadge tone={renewing ? "success" : ending ? "warning" : "neutral"}>
          {renewing ? "Ativa" : ending ? "Ativa, não renova no fim do ciclo" : "Cancelada"}
        </StatusBadge>
      }
      meta={
        <>
          <span>{sub.terms.sessions_per_cycle} × {sub.terms.service_name ?? "sessão"} {cycleLabel(sub.terms.cycle_days)} por {formatCents(sub.terms.price_cents)} (termos aceitos em {formatDate(sub.accepted_at, timezone)})</span>
          {c ? (
            <span>
              Ciclo {c.cycle_no}: {formatDate(c.starts_at, timezone)} a {formatDate(c.ends_at, timezone)} · {c.package.remaining_credits} de {c.package.purchased_credits} sessões restantes · {RECEIVABLE_STATUS[c.receivable.status]} ({formatCents(c.receivable.amount_cents)})
              {sub.next_renewal_at && renewing ? ` · renova em ${formatDate(sub.next_renewal_at, timezone)}` : ""}
            </span>
          ) : null}
        </>
      }
      action={action}
      more={more}
      moreLabel={`Mais ações para ${who}`}
      below={
        panel || history ? (
          <>
            {panel === "end" && renewing ? (
              <EndPanel who={who} reason={reason} onReason={setReason} busy={busy === "end"} onEnd={() => void cancelAtEnd()} onClose={() => setPanel(null)} />
            ) : null}
            {panel === "now" && renewing ? (
              <InlineConfirm
                title={`Encerrar a assinatura de ${who} agora?`}
                consequence={
                  <p>
                    {sub.customer_name ?? "A cliente"} deixa de assinar hoje e nada mais renova.
                    {c ? ` ${c.package.remaining_credits === 1 ? "A sessão restante do ciclo atual continua" : `As ${c.package.remaining_credits} sessões restantes do ciclo atual continuam`} valendo até ${formatDate(c.ends_at, timezone)}, e a cobrança deste ciclo (${formatCents(c.receivable.amount_cents)}) continua no Caixa.` : ""}
                    {" "}Para desfazer, será preciso uma nova adesão. Se quiser só parar de renovar, use “Cancelar no fim do ciclo”.
                  </p>
                }
                confirmLabel="Sim, encerrar agora"
                onClose={() => setPanel(null)}
                onConfirm={cancelNow}
              >
                <Field label="Motivo (opcional)" maxLength={280} value={reason} onChange={(e) => setReason(e.target.value)} />
              </InlineConfirm>
            ) : null}
            {history ? (
              <ul className="tn-rc-cycles" aria-label={`Ciclos de ${who}`}>
                {history.map((h) => <li key={h.id}>Ciclo {h.cycle_no} · {formatDate(h.starts_at, timezone)} a {formatDate(h.ends_at, timezone)} · {h.package.remaining_credits}/{h.package.purchased_credits} sessões · {RECEIVABLE_STATUS[h.receivable.status]}</li>)}
              </ul>
            ) : null}
          </>
        ) : undefined
      }
    />
  );
}

export function RecurrencePage({ port }: { port: RecurrencePort }) {
  const [base, setBase] = useState<RecurrenceBase | null>(null);
  const [plans, setPlans] = useState<RecurrencePlan[]>([]);
  const [subs, setSubs] = useState<RecurrenceSubscription[] | null>(null);
  // O servidor devolve no máximo 200 assinaturas (P56): a lista avisa quando cortou.
  const [truncated, setTruncated] = useState(false);
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
      setSubs(s.subscriptions);
      setTruncated(s.truncated);
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
      toast({ tone: "info", message: `Renovação (simulação): ${plural(r.renewed, "ciclo aberto", "ciclos abertos")}, ${plural(r.closed, "assinatura encerrada", "assinaturas encerradas")}.` });
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
        subtitle="Assinar não é receber: a cobrança fica no Caixa."
        actions={base && plans.some((p) => p.active) && open !== "sub" ? (
          <Button onClick={() => setOpen("sub")}>
            <Icon name="mais" size={20} />
            Nova assinatura
          </Button>
        ) : null}
        help={
          <>
            <p>Planos do seu negócio (ex.: 4 cortes por mês) e as clientes que assinam. Cada ciclo abre as sessões e uma cobrança pelo preço aceito; o Caixa recebe (por Pix ou registro manual). Mudar um plano não muda quem já assina; cancelar preserva o que foi aceito e o saldo do ciclo.</p>
            {port.kind === "demo" ? <p>Na demonstração nada é cobrado. “Avançar o ciclo”, no fim da tela, simula agora a renovação que o sistema faz sozinho.</p> : null}
          </>
        }
      />
      {error ? <StatusBanner tone="danger">{explain(error)}</StatusBanner> : null}

      {open === "sub" && base ? (
        <Card aria-labelledby="rc-new-sub-title">
          <h2 id="rc-new-sub-title">Nova assinatura</h2>
          <SubscribeForm key={`sub:${nonce}`} port={port} base={base} plans={plans} onDone={saved} />
          <div className="tn-actions"><Button variant="ghost" onClick={() => setOpen(null)}>Fechar</Button></div>
        </Card>
      ) : null}

      <Section id="rc-subs-title" title="Assinantes" count={subs?.length || undefined}>
        {base && !plans.some((p) => p.active) ? <p className="tn-muted">Crie um plano ativo para registrar adesões.</p> : null}
        {subs && subs.length === 0 ? <p className="tn-muted">Nenhuma assinatura ainda.</p> : null}
        {subs?.length ? (
          <CappedList
            items={subs}
            label="Assinaturas"
            truncated={truncated}
            truncatedText="Mostrando as 200 assinaturas mais recentes."
            render={(s) => <SubscriptionItem key={s.id} sub={s} port={port} timezone={timezone} onDone={reload} />}
          />
        ) : null}
      </Section>

      {/* Planos são configuração: seção secundária, recolhida quando já existe plano. */}
      <Section id="rc-plans-title" title="Planos" count={plans.length || undefined} collapsed={!base || plans.length > 0}>
        {base && open !== "plan" ? (
          <div className="tn-actions"><Button variant="secondary" onClick={() => setOpen("plan")}><Icon name="mais" size={20} />Novo plano</Button></div>
        ) : null}
        {open === "plan" && base ? (
          <div className="tn-rc-new">
            <PlanForm key={`new:${nonce}`} port={port} base={base} plan={null} onDone={saved} />
            <div className="tn-actions"><Button variant="ghost" onClick={() => setOpen(null)}>Fechar</Button></div>
          </div>
        ) : null}
        {plans.length === 0 ? <p className="tn-muted">Nenhum plano ainda. Crie o primeiro em “Novo plano”.</p> : (
          <ul className="tn-list" aria-label="Planos cadastrados">
            {plans.map((p) => (
              <Row
                key={p.id}
                title={p.name}
                badge={p.active ? undefined : <StatusBadge tone="neutral">Inativo</StatusBadge>}
                meta={`${p.sessions_per_cycle} × ${p.service_name ?? "sessão"} ${cycleLabel(p.cycle_days)} · ${formatCents(p.price_cents)} · ${plural(p.subscribers, "assinante")}`}
                action={<Button size="compact" variant="ghost" aria-expanded={editing === p.id} onClick={() => setEditing(editing === p.id ? null : p.id)}>{editing === p.id ? "Fechar" : "Editar"}</Button>}
                below={editing === p.id && base ? <PlanForm port={port} base={base} plan={p} onDone={saved} /> : undefined}
              />
            ))}
          </ul>
        )}
      </Section>
      {port.tick ? <div className="tn-actions"><Button variant="secondary" loading={ticking} onClick={() => void tick()}>Avançar o ciclo (simulação)</Button></div> : null}
    </div>
  );
}
