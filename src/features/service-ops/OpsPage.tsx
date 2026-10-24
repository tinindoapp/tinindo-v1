// Operação Tinindo (P15): fila de pedidos de todos os negócios para a equipe. Não há acesso global: o operador só
// começa e só lê dados com a concessão do dono, e a leitura fica registrada para o dono ver. Minutos têm teto.
import { type FormEvent, useEffect, useState } from "react";
import { Button, Card, PageHeader, StatusBanner } from "../../components/ui/index.tsx";
import { explain, formatCents, minutesText, ORDER_STATUS, SCOPE_LABEL } from "./labels.ts";
import { newKey, type OpsPort, type OpsQueue, type QueueOrder, type Snapshot } from "./port.ts";

type Notice = { tone: "success" | "danger"; text: string } | null;

function WorkForm({ port, order, onDone }: { port: OpsPort; order: QueueOrder; onDone: (n: Notice) => void }) {
  const [minutes, setMinutes] = useState("30");
  const [kind, setKind] = useState<"human" | "automation">("human");
  const [reprocess, setReprocess] = useState(false);
  const [key, setKey] = useState(newKey);
  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      await port.logWork(order, Number(minutes), kind, reprocess, null, key);
      setKey(newKey());
      onDone({ tone: "success", text: `${minutes} min registrados.` });
    } catch (err) {
      onDone({ tone: "danger", text: explain(err) });
    }
  }
  return (
    <form className="tn-svc-form" aria-label="Registrar minutos" onSubmit={(e) => void submit(e)}>
      <label className="tn-svc-field">Minutos
        <input inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
      </label>
      <label className="tn-svc-field">Tipo
        <select value={kind} onChange={(e) => setKind(e.target.value as "human" | "automation")}>
          <option value="human">Trabalho humano</option>
          <option value="automation">Automação</option>
        </select>
      </label>
      <label className="tn-svc-check"><input type="checkbox" checked={reprocess} onChange={(e) => setReprocess(e.target.checked)} /> Retrabalho</label>
      <Button type="submit" variant="secondary">Registrar minutos</Button>
    </form>
  );
}

function DeliverForm({ port, order, onDone }: { port: OpsPort; order: QueueOrder; onDone: (n: Notice) => void }) {
  const [title, setTitle] = useState("");
  const [evidence, setEvidence] = useState("");
  const [key] = useState(newKey);
  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      await port.deliver(order, title, evidence, key);
      onDone({ tone: "success", text: "Entrega enviada para revisão do cliente." });
    } catch (err) {
      onDone({ tone: "danger", text: explain(err) });
    }
  }
  return (
    <form className="tn-svc-form" aria-label="Enviar entrega" onSubmit={(e) => void submit(e)}>
      <label className="tn-svc-field">Título da entrega
        <input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="tn-svc-field">Evidência (o que foi feito, sem dados de clientes)
        <input value={evidence} maxLength={500} onChange={(e) => setEvidence(e.target.value)} />
      </label>
      <Button type="submit" disabled={!title.trim() || !evidence.trim()}>Enviar entrega</Button>
    </form>
  );
}

function BlockForm({ port, order, onDone }: { port: OpsPort; order: QueueOrder; onDone: (n: Notice) => void }) {
  const [reason, setReason] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      await port.block(order, reason.trim(), newKey());
      setReason("");
      onDone({ tone: "success", text: "Pedido bloqueado com o motivo registrado." });
    } catch (err) {
      onDone({ tone: "danger", text: explain(err) });
    }
  }
  return (
    <form className="tn-svc-form" aria-label="Bloquear pedido" onSubmit={(e) => void submit(e)}>
      <label className="tn-svc-field">Motivo do bloqueio
        <input value={reason} maxLength={280} onChange={(e) => setReason(e.target.value)} />
      </label>
      <Button type="submit" variant="ghost" disabled={!reason.trim()}>Bloquear</Button>
    </form>
  );
}

export function OpsPage({ port }: { port: OpsPort }) {
  const [queue, setQueue] = useState<OpsQueue | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [snap, setSnap] = useState<{ orderId: string; data: Snapshot } | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    port.queue().then((q) => alive && setQueue(q), (e: unknown) => alive && setError(e ?? new Error("erro")));
    return () => { alive = false; };
  }, [port, nonce]);
  const done = (n: Notice) => {
    setNotice(n);
    setNonce((x) => x + 1);
  };
  const act = (run: () => Promise<unknown>, ok: string) => run().then(() => done({ tone: "success", text: ok }), (e: unknown) => done({ tone: "danger", text: explain(e) }));

  const forbidden = (error as { code?: string } | null)?.code === "FORBIDDEN";
  return (
    <div className="tn-svc">
      <div className="tn-page-intro">
        <PageHeader id="ops-title" title="Operação Tinindo" />
        <p className="tn-svc-muted">Fila dos serviços assistidos. Sem acesso concedido pelo cliente não dá para começar nem ler dados; cada leitura fica no registro do cliente.</p>
        {port.kind === "demo" ? <StatusBanner tone="info"><strong>Dados de exemplo.</strong> Na demonstração você também é a operadora.</StatusBanner> : null}
        {forbidden ? <StatusBanner tone="warning">Só a equipe Tinindo acessa esta tela.</StatusBanner> : null}
        {error && !forbidden ? <StatusBanner tone="danger">{explain(error)}</StatusBanner> : null}
        {notice ? <StatusBanner tone={notice.tone}>{notice.text}</StatusBanner> : null}
      </div>
      {queue ? (
        <Card aria-labelledby="ops-queue-title">
          <h2 id="ops-queue-title">Fila</h2>
          {queue.orders.length === 0 ? <p className="tn-svc-muted">Nenhum pedido.</p> : null}
          <ul className="tn-svc-list">
            {queue.orders.map((o) => {
              const mine = o.assignee_user_id === queue.operator.user_id;
              return (
                <li key={o.id} className="tn-svc-order">
                  <h3>{o.tenant_name} · {o.offering.name}</h3>
                  <p><strong>{ORDER_STATUS[o.status]}</strong> · {minutesText(o.minutes_used, o.minutes_quota)} · {formatCents(o.price_cents)}</p>
                  <p className="tn-svc-muted">
                    {o.assignee_name ? `Responsável: ${o.assignee_name}` : "Sem responsável"} ·{" "}
                    {o.has_access ? `Acesso concedido: ${o.access_scopes.map((s) => SCOPE_LABEL[s]).join(", ")}` : "Sem acesso concedido"}
                  </p>
                  <div className="tn-svc-actions">
                    {!mine && o.status !== "delivered" && o.status !== "cancelled" ? (
                      <Button variant="secondary" onClick={() => void act(() => port.assign(o, queue.operator.user_id, newKey()), "Pedido assumido.")}>Assumir</Button>
                    ) : null}
                    {mine && ["scope_accepted", "awaiting_access", "blocked"].includes(o.status) ? (
                      <Button onClick={() => void act(() => port.start(o, newKey()), "Execução iniciada.")}>Começar</Button>
                    ) : null}
                    {o.has_access ? (
                      <Button variant="ghost" onClick={() => void port.snapshot(o).then((d) => setSnap({ orderId: o.id, data: d }), (e: unknown) => done({ tone: "danger", text: explain(e) }))}>
                        Ver dados concedidos
                      </Button>
                    ) : null}
                  </div>
                  {snap?.orderId === o.id ? (
                    <div className="tn-svc-box" role="group" aria-label="Dados concedidos">
                      <p className="tn-svc-muted">Leitura registrada para o cliente. Acesso até {new Date(snap.data.expires_at).toLocaleDateString("pt-BR")}.</p>
                      {snap.data.catalog ? <p>Serviços: {snap.data.catalog.map((s) => `${s.name} (${s.duration_min} min)`).join(", ") || "nenhum"}</p> : null}
                      {snap.data.agenda ? <p>Agenda: {snap.data.agenda.length} atendimentos nos próximos 14 dias</p> : null}
                      {snap.data.customers ? <p>Clientes: {snap.data.customers.count}</p> : null}
                    </div>
                  ) : null}
                  {mine && (o.status === "in_progress" || o.status === "client_review") ? <WorkForm port={port} order={o} onDone={done} /> : null}
                  {mine && o.status === "in_progress" ? <DeliverForm port={port} order={o} onDone={done} /> : null}
                  {mine && !["delivered", "cancelled", "blocked"].includes(o.status) ? <BlockForm port={port} order={o} onDone={done} /> : null}
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
