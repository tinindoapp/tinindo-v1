// Operação Tinindo (P15): fila de pedidos de todos os negócios para a equipe. Não há acesso global: o operador só
// começa e só lê dados com a concessão do dono, e a leitura fica registrada para o dono ver. Minutos têm teto.
import { type FormEvent, useEffect, useState } from "react";
import { Button, Card, Field, PageHeader, StatusBanner, toast, useFormErrors } from "../../components/ui/index.tsx";
import { explain, formatCents, minutesText, ORDER_STATUS, SCOPE_LABEL } from "./labels.ts";
import { newKey, type OpsPort, type OpsQueue, type QueueOrder, type Snapshot } from "./port.ts";

/** Resultado de uma ação: vira toast (sucesso ou perigo) e a fila recarrega. */
type Notice = { tone: "success" | "danger"; text: string };

function WorkForm({ port, order, onDone }: { port: OpsPort; order: QueueOrder; onDone: (n: Notice) => void }) {
  const [minutes, setMinutes] = useState("30");
  const [kind, setKind] = useState<"human" | "automation">("human");
  const [reprocess, setReprocess] = useState(false);
  const [key, setKey] = useState(newKey);
  const [pending, setPending] = useState(false);
  const { formRef, errors, show, clear } = useFormErrors<"minutes">();
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!show({ minutes: /^\d+$/.test(minutes.trim()) && Number(minutes) > 0 ? null : "Informe os minutos (número inteiro maior que zero)." })) return;
    setPending(true);
    try {
      await port.logWork(order, Number(minutes), kind, reprocess, null, key);
      setKey(newKey());
      onDone({ tone: "success", text: `${minutes} min registrados.` });
    } catch (err) {
      onDone({ tone: "danger", text: explain(err) });
    } finally {
      setPending(false);
    }
  }
  return (
    <form className="tn-svc-form" aria-label="Registrar minutos" ref={formRef} noValidate onSubmit={(e) => void submit(e)}>
      <Field
        className="tn-svc-field tn-svc-field--small"
        label="Minutos"
        inputMode="numeric"
        value={minutes}
        error={errors.minutes}
        onChange={(e) => {
          setMinutes(e.target.value);
          clear("minutes");
        }}
      />
      <Field as="select" className="tn-svc-field" label="Tipo" value={kind} onChange={(e) => setKind(e.target.value as "human" | "automation")}>
        <option value="human">Trabalho humano</option>
        <option value="automation">Automação</option>
      </Field>
      <label className="tn-svc-check"><input type="checkbox" checked={reprocess} onChange={(e) => setReprocess(e.target.checked)} /> Retrabalho</label>
      <Button type="submit" variant="secondary" loading={pending}>Registrar minutos</Button>
    </form>
  );
}

function DeliverForm({ port, order, onDone }: { port: OpsPort; order: QueueOrder; onDone: (n: Notice) => void }) {
  const [title, setTitle] = useState("");
  const [evidence, setEvidence] = useState("");
  const [key] = useState(newKey);
  const [pending, setPending] = useState(false);
  const { formRef, errors, show, clear } = useFormErrors<"title" | "evidence">();
  async function submit(e: FormEvent) {
    e.preventDefault();
    const ok = show({
      title: title.trim() ? null : "Informe o título da entrega.",
      evidence: evidence.trim() ? null : "Descreva o que foi feito.",
    });
    if (!ok) return;
    setPending(true);
    try {
      await port.deliver(order, title, evidence, key);
      onDone({ tone: "success", text: "Entrega enviada para revisão do cliente." });
    } catch (err) {
      onDone({ tone: "danger", text: explain(err) });
    } finally {
      setPending(false);
    }
  }
  return (
    <form className="tn-svc-form" aria-label="Enviar entrega" ref={formRef} noValidate onSubmit={(e) => void submit(e)}>
      <Field
        className="tn-svc-field"
        label="Título da entrega"
        value={title}
        maxLength={120}
        error={errors.title}
        onChange={(e) => {
          setTitle(e.target.value);
          clear("title");
        }}
      />
      <Field
        className="tn-svc-field"
        label="Evidência (o que foi feito, sem dados de clientes)"
        value={evidence}
        maxLength={500}
        error={errors.evidence}
        onChange={(e) => {
          setEvidence(e.target.value);
          clear("evidence");
        }}
      />
      <Button type="submit" loading={pending}>Enviar entrega</Button>
    </form>
  );
}

function BlockForm({ port, order, onDone }: { port: OpsPort; order: QueueOrder; onDone: (n: Notice) => void }) {
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const { formRef, errors, show, clear } = useFormErrors<"reason">();
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!show({ reason: reason.trim() ? null : "Informe o motivo do bloqueio." })) return;
    setPending(true);
    try {
      await port.block(order, reason.trim(), newKey());
      setReason("");
      onDone({ tone: "success", text: "Pedido bloqueado com o motivo registrado." });
    } catch (err) {
      onDone({ tone: "danger", text: explain(err) });
    } finally {
      setPending(false);
    }
  }
  return (
    <form className="tn-svc-form" aria-label="Bloquear pedido" ref={formRef} noValidate onSubmit={(e) => void submit(e)}>
      <Field
        className="tn-svc-field"
        label="Motivo do bloqueio"
        value={reason}
        maxLength={280}
        error={errors.reason}
        onChange={(e) => {
          setReason(e.target.value);
          clear("reason");
        }}
      />
      <Button type="submit" variant="ghost" loading={pending}>Bloquear</Button>
    </form>
  );
}

export function OpsPage({ port }: { port: OpsPort }) {
  const [queue, setQueue] = useState<OpsQueue | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [snap, setSnap] = useState<{ orderId: string; data: Snapshot } | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    port.queue().then((q) => alive && setQueue(q), (e: unknown) => alive && setError(e ?? new Error("erro")));
    return () => { alive = false; };
  }, [port, nonce]);
  const done = (n: Notice) => {
    toast({ tone: n.tone, message: n.text });
    setNonce((x) => x + 1);
  };
  const act = (run: () => Promise<unknown>, ok: string) => run().then(() => done({ tone: "success", text: ok }), (e: unknown) => done({ tone: "danger", text: explain(e) }));

  const forbidden = (error as { code?: string } | null)?.code === "FORBIDDEN";
  return (
    <div className="tn-svc">
      <div className="tn-page-intro">
        <PageHeader id="ops-title" title="Operação Tinindo" />
        <p className="tn-muted">Fila dos serviços assistidos. Sem acesso concedido pelo cliente não dá para começar nem ler dados; cada leitura fica no registro do cliente.</p>
        {port.kind === "demo" ? <StatusBanner tone="info"><strong>Dados de exemplo.</strong> Na demonstração você também é a operadora.</StatusBanner> : null}
        {forbidden ? <StatusBanner tone="warning">Só a equipe Tinindo acessa esta tela.</StatusBanner> : null}
        {error && !forbidden ? <StatusBanner tone="danger">{explain(error)}</StatusBanner> : null}
      </div>
      {queue ? (
        <Card aria-labelledby="ops-queue-title">
          <h2 id="ops-queue-title">Fila</h2>
          {queue.orders.length === 0 ? <p className="tn-muted">Nenhum pedido.</p> : null}
          <ul className="tn-svc-list">
            {queue.orders.map((o) => {
              const mine = o.assignee_user_id === queue.operator.user_id;
              return (
                <li key={o.id} className="tn-svc-order">
                  <h3>{o.tenant_name} · {o.offering.name}</h3>
                  <p><strong>{ORDER_STATUS[o.status]}</strong> · {minutesText(o.minutes_used, o.minutes_quota)} · {formatCents(o.price_cents)}</p>
                  <p className="tn-muted">
                    {o.assignee_name ? `Responsável: ${o.assignee_name}` : "Sem responsável"} ·{" "}
                    {o.has_access ? `Acesso concedido: ${o.access_scopes.map((s) => SCOPE_LABEL[s]).join(", ")}` : "Sem acesso concedido"}
                  </p>
                  <div className="tn-actions">
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
                      <p className="tn-muted">Leitura registrada para o cliente. Acesso até {new Date(snap.data.expires_at).toLocaleDateString("pt-BR")}.</p>
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
