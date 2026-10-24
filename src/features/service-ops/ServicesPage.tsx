// Plano e serviços (P15), visão do dono. O plano fixa a versão aceita; serviços humanos têm escopo, preço e franquia
// de minutos próprios. A equipe Tinindo só acessa dados do negócio com a concessão daqui, e cada leitura aparece no registro.
import { createContext, type FormEvent, useContext, useEffect, useState } from "react";
import type { AccessScope, OfferingVersion, ServiceOrderDetail } from "@contracts";
import { Button, Card, PageHeader, StatusBanner } from "../../components/ui/index.tsx";
import { ACTION_LABEL, explain, formatDateTime, minutesText, ORDER_STATUS, priceLabel, SCOPE_LABEL } from "./labels.ts";
import { type AccessLog, newKey, type PlanCurrent, type ServiceOpsPort } from "./port.ts";

const PortContext = createContext<ServiceOpsPort | null>(null);
export const ServiceOpsPortProvider = PortContext.Provider;
function usePort(): ServiceOpsPort {
  const p = useContext(PortContext);
  if (!p) throw new Error("usePort fora de Plano e serviços");
  return p;
}
type Notice = { tone: "success" | "danger"; text: string } | null;

function Scope({ v }: { v: OfferingVersion }) {
  return (
    <div className="tn-svc-scope">
      <p className="tn-svc-muted">{v.description}</p>
      <p><strong>Inclui:</strong> {v.included.join("; ")}.</p>
      <p><strong>Não inclui:</strong> {v.excluded.join("; ")}.</p>
    </div>
  );
}

function RequestService({ v, onDone }: { v: OfferingVersion; onDone: (n: Notice) => void }) {
  const port = usePort();
  const [ok, setOk] = useState(false);
  const [notes, setNotes] = useState("");
  const [key] = useState(newKey);
  const [pending, setPending] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    try {
      await port.request(v, notes.trim() || null, key);
      onDone({ tone: "success", text: `Pedido de “${v.name}” registrado com o escopo da versão ${v.version_no}. A equipe Tinindo vai definir um responsável.` });
    } catch (err) {
      onDone({ tone: "danger", text: explain(err) });
    } finally {
      setPending(false);
    }
  }
  return (
    <form className="tn-svc-form" aria-label={`Pedir ${v.name}`} onSubmit={(e) => void submit(e)}>
      <label className="tn-svc-check">
        <input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} />
        Li e aceito este escopo (versão {v.version_no})
      </label>
      <label className="tn-svc-field">Observação para a equipe (opcional)
        <input value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} />
      </label>
      <Button type="submit" disabled={!ok || pending}>Pedir este serviço</Button>
    </form>
  );
}

function GrantForm({ order, onDone }: { order: ServiceOrderDetail; onDone: (n: Notice) => void }) {
  const port = usePort();
  const [scopes, setScopes] = useState<AccessScope[]>(["catalog"]);
  const [days, setDays] = useState("7");
  const [why, setWhy] = useState("");
  const [key, setKey] = useState(newKey);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!why.trim() || scopes.length === 0) {
      onDone({ tone: "danger", text: "Escolha o que liberar e diga para quê." });
      return;
    }
    try {
      await port.grant(order, scopes, new Date(port.now().getTime() + Number(days) * 86_400_000).toISOString(), why.trim(), key);
      setKey(newKey());
      onDone({ tone: "success", text: `Acesso concedido a ${order.assignee_name ?? "o responsável"} por ${days} dias. Você pode revogar quando quiser.` });
    } catch (err) {
      onDone({ tone: "danger", text: explain(err) });
    }
  }
  const toggle = (s: AccessScope, on: boolean) => setScopes((x) => (on ? [...new Set([...x, s])] : x.filter((y) => y !== s)));
  return (
    <form className="tn-svc-form" aria-label="Conceder acesso" onSubmit={(e) => void submit(e)}>
      <fieldset className="tn-svc-fieldset">
        <legend>Liberar para {order.assignee_name ?? "o responsável"}</legend>
        {(Object.keys(SCOPE_LABEL) as AccessScope[]).map((s) => (
          <label key={s} className="tn-svc-check">
            <input type="checkbox" checked={scopes.includes(s)} onChange={(e) => toggle(s, e.target.checked)} />
            {SCOPE_LABEL[s]}
          </label>
        ))}
      </fieldset>
      <label className="tn-svc-field">Por quanto tempo
        <select value={days} onChange={(e) => setDays(e.target.value)}>
          {["1", "3", "7", "14", "30"].map((d) => <option key={d} value={d}>{d} {d === "1" ? "dia" : "dias"}</option>)}
        </select>
      </label>
      <label className="tn-svc-field">Para quê
        <input value={why} maxLength={280} onChange={(e) => setWhy(e.target.value)} />
      </label>
      <Button type="submit">Conceder acesso</Button>
    </form>
  );
}

function OrderCard({ order, tz, onDone }: { order: ServiceOrderDetail; tz: string; onDone: (n: Notice) => void }) {
  const port = usePort();
  const [note, setNote] = useState("");
  const last = order.deliverables[0];
  const open = order.status !== "delivered" && order.status !== "cancelled";
  const act = (run: () => Promise<unknown>, ok: string) => run().then(() => onDone({ tone: "success", text: ok }), (e: unknown) => onDone({ tone: "danger", text: explain(e) }));
  return (
    <li className="tn-svc-order">
      <h3>{order.offering.name}</h3>
      <p><strong>{ORDER_STATUS[order.status]}</strong>{order.blocked_reason ? `: ${order.blocked_reason}` : ""}</p>
      <p className="tn-svc-muted">
        {priceLabel(order.price_cents, order.offering.billing)} · {minutesText(order.minutes_used, order.minutes_quota)}
        {order.reprocess_minutes > 0 ? ` (${order.reprocess_minutes} de retrabalho)` : ""}
        {order.assignee_name ? ` · responsável: ${order.assignee_name}` : " · sem responsável ainda"}
        {order.due_at ? ` · prazo ${formatDateTime(order.due_at, tz)}` : ""}
      </p>
      {last && order.status === "client_review" ? (
        <div className="tn-svc-box" role="group" aria-label="Entrega para revisar">
          <p><strong>Entrega {last.version_no}: {last.title}</strong></p>
          <p>{last.evidence}</p>
          <label className="tn-svc-field">Comentário (opcional)
            <input value={note} maxLength={280} onChange={(e) => setNote(e.target.value)} />
          </label>
          <div className="tn-svc-actions">
            <Button onClick={() => void act(() => port.review(order, last.id, "approved", note.trim() || null, newKey()),
              "Entrega aprovada. O acesso da equipe foi encerrado.")}>Aprovar entrega</Button>
            <Button variant="secondary" onClick={() => void act(() => port.review(order, last.id, "changes_requested", note.trim() || null, newKey()),
              "Ajustes pedidos. O pedido voltou para execução.")}>Pedir ajustes</Button>
          </div>
        </div>
      ) : null}
      {open && order.assignee_user_id ? <GrantForm order={order} onDone={onDone} /> : null}
      {order.grants.length > 0 ? (
        <ul className="tn-svc-list" aria-label="Acessos concedidos">
          {order.grants.map((g) => (
            <li key={g.id} className="tn-svc-row">
              <span>
                {g.operator_name ?? "Equipe Tinindo"}: {g.scopes.map((s) => SCOPE_LABEL[s]).join(", ")} ·{" "}
                {g.active ? `ativo até ${formatDateTime(g.expires_at, tz)}` : "encerrado"}
              </span>
              {g.active ? <Button variant="ghost" onClick={() => void act(() => port.revoke(g.id, newKey()), "Acesso revogado.")}>Revogar acesso</Button> : null}
            </li>
          ))}
        </ul>
      ) : null}
      <details>
        <summary>Histórico</summary>
        <ol className="tn-svc-list">
          {order.events.map((e, n) => <li key={n}>{formatDateTime(e.occurred_at, tz)} · {ORDER_STATUS[e.to_status]}{e.note ? ` (${e.note})` : ""}</li>)}
        </ol>
      </details>
      {open ? <Button variant="ghost" onClick={() => void act(() => port.cancel(order, newKey()), "Pedido cancelado. Acessos encerrados.")}>Cancelar pedido</Button> : null}
    </li>
  );
}

export function ServicesPage() {
  const port = usePort();
  const [tz, setTz] = useState("America/Sao_Paulo");
  const [plan, setPlan] = useState<PlanCurrent | null>(null);
  const [orders, setOrders] = useState<ServiceOrderDetail[] | null>(null);
  const [log, setLog] = useState<AccessLog>([]);
  const [notice, setNotice] = useState<Notice>(null);
  const [error, setError] = useState<unknown>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    Promise.all([port.timezone(), port.plan(), port.orders(), port.accessLog()]).then(([t, p, o, l]) => {
      if (!alive) return;
      setTz(t);
      setPlan(p);
      setOrders(o);
      setLog(l);
    }, (e: unknown) => alive && setError(e ?? new Error("erro")));
    return () => { alive = false; };
  }, [port, nonce]);
  const done = (n: Notice) => {
    setNotice(n);
    setNonce((x) => x + 1);
  };

  if (error && !plan) {
    return (
      <div className="tn-page-intro">
        <PageHeader id="svc-title" title="Plano e serviços" />
        <StatusBanner tone="danger">{explain(error)}</StatusBanner>
      </div>
    );
  }
  const plans = plan?.catalog.filter((c) => c.kind === "plan") ?? [];
  const services = plan?.catalog.filter((c) => c.kind === "service") ?? [];

  return (
    <div className="tn-svc">
      <div className="tn-page-intro">
        <PageHeader id="svc-title" title="Plano e serviços" />
        <p className="tn-svc-muted">
          Serviços feitos pela equipe Tinindo têm escopo, preço e minutos próprios e não estão no plano. No piloto a cobrança da Tinindo
          é combinada à parte: registrar plano ou pedido <strong>não é pagamento</strong>.
        </p>
        {port.kind === "demo" ? <StatusBanner tone="info"><strong>Dados de exemplo.</strong> Demonstração sem servidor: nada é cobrado.</StatusBanner> : null}
        {notice ? <StatusBanner tone={notice.tone}>{notice.text}</StatusBanner> : null}
      </div>

      {plan ? (
        <Card aria-labelledby="svc-plan-title">
          <h2 id="svc-plan-title">Seu plano</h2>
          <p>
            <strong>{plan.plan.name}</strong> · {priceLabel(plan.subscription?.price_cents ?? plan.plan.price_cents, plan.plan.billing)}
            {plan.subscription ? ` · desde ${formatDateTime(plan.subscription.started_at, tz)}` : " · padrão, sem assinatura registrada"}
          </p>
          {plan.usage ? <p className="tn-svc-muted">Assistente: {plan.usage.agent_questions_used} de {plan.usage.agent_questions_limit} perguntas neste mês.</p> : null}
          {!plan.plan_is_latest ? <StatusBanner tone="info">Há uma versão mais nova deste plano. Seu preço e sua franquia continuam os que você aceitou.</StatusBanner> : null}
          <ul className="tn-svc-list">
            {plans.map((v) => (
              <li key={v.id} className="tn-svc-offer">
                <h3>{v.name} · {priceLabel(v.price_cents, v.billing)}</h3>
                <Scope v={v} />
                <p className="tn-svc-muted">Assistente: {v.agent_questions_month} perguntas/mês.</p>
                {plan.plan.id === v.id ? <p><strong>Plano atual</strong></p> : (
                  <Button variant="secondary" onClick={() => void port.subscribe(v, newKey()).then(
                    () => done({ tone: "success", text: `Plano alterado para ${v.name}. A franquia já vale; a cobrança é combinada à parte.` }),
                    (e: unknown) => done({ tone: "danger", text: explain(e) }))}>Escolher {v.name}</Button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      ) : <p role="status">Carregando…</p>}

      {services.length > 0 ? (
        <Card aria-labelledby="svc-catalog-title">
          <h2 id="svc-catalog-title">Serviços assistidos</h2>
          <ul className="tn-svc-list">
            {services.map((v) => (
              <li key={v.id} className="tn-svc-offer">
                <h3>{v.name} · {priceLabel(v.price_cents, v.billing)}</h3>
                <Scope v={v} />
                <p className="tn-svc-muted">Até {v.assisted_minutes} minutos de trabalho da equipe · prazo de referência {v.sla_days} dias.</p>
                <RequestService v={v} onDone={done} />
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card aria-labelledby="svc-orders-title">
        <h2 id="svc-orders-title">Seus pedidos</h2>
        {orders?.length === 0 ? <p className="tn-svc-muted">Nenhum pedido ainda.</p> : null}
        <ul className="tn-svc-list">{orders?.map((o) => <OrderCard key={o.id} order={o} tz={tz} onDone={done} />)}</ul>
      </Card>

      <Card aria-labelledby="svc-log-title">
        <h2 id="svc-log-title">Registro de acesso</h2>
        <p className="tn-svc-muted">Tudo o que a equipe Tinindo fez ou leu no seu negócio.</p>
        {log.length === 0 ? <p className="tn-svc-muted">Nenhum acesso até agora.</p> : (
          <ol className="tn-svc-list">
            {log.map((e, n) => (
              <li key={n}>{formatDateTime(e.occurred_at, tz)} · {e.actor_name}: {ACTION_LABEL[e.action] ?? e.action}
                {e.scopes ? ` (${e.scopes.map((s) => SCOPE_LABEL[s]).join(", ")})` : ""}</li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}
