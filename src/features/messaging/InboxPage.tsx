// Canal (P12): conexão do número e caixa de entrada (/app/mensagens), conversa (/app/mensagens/:id). O que a tela promete é o que o banco garante:
// enviado, entregue, lido, falhou e desconhecido são estados diferentes; nada é reenviado sozinho; fora da janela
// de 24 h só modelo aprovado; a cliente que pediu SAIR não recebe nada; humano assume quando você pede.
import { type FormEvent, useEffect, useId, useState } from "react";
import { Link } from "react-router";
import { Button, Card, ConfirmAction, Field, Help, PageHeader, StatusBanner, toast, useFormErrors } from "../../components/ui/index.tsx";
import { Icon } from "../../components/ui/icons.tsx";
import { CONNECTION_STATUS, explain, FAILURE_REASON, formatPhone, formatTime, MESSAGE_STATUS, PROVIDER_LABEL, unreadLabel } from "./labels.ts";
import { type ChannelProvider, type ChannelStatus, type Conversation, type Inbox, type MessagingPort, newKey } from "./port.ts";

/** Depois de uma ação: o aviso de sucesso sai no toast e a tela recarrega. Erro de formulário fica no formulário. */
type Done = (message: string) => void;

function ConnectForm({ port, onDone }: { port: MessagingPort; onDone: Done }) {
  const [provider, setProvider] = useState<ChannelProvider>("simulated");
  const [phone, setPhone] = useState("+5511999990001");
  const [key, setKey] = useState(newKey);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const { formRef, errors, show } = useFormErrors<"phone">();
  async function submit(e: FormEvent) {
    e.preventDefault();
    const value = phone.trim();
    if (!show({ phone: !value ? "Informe o número do negócio, ex.: +5511999990001." : !/^\+[1-9]\d{7,14}$/.test(value) && "Use o formato internacional: + código do país, DDD e número, ex.: +5511999990001." })) return;
    setBusy(true);
    setFailure(null);
    try {
      await port.connect(provider, value, key);
      setKey(newKey());
      onDone("Número registrado. O código de verificação sai pelo próprio canal: confira o telefone e informe abaixo.");
    } catch (err) {
      setKey(newKey());
      setFailure(explain(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form ref={formRef} className="tn-msg-form" aria-label="Conectar número" onSubmit={(e) => void submit(e)} noValidate>
      <Field as="select" label="Provedor" value={provider} onChange={(e) => setProvider(e.target.value as ChannelProvider)}>
        <option value="simulated">{PROVIDER_LABEL.simulated}</option>
        <option value="whatsapp_cloud">{PROVIDER_LABEL.whatsapp_cloud}</option>
      </Field>
      <Field label="Número do negócio (formato internacional)" inputMode="tel" value={phone} error={errors.phone} onChange={(e) => setPhone(e.target.value)} />
      <Button type="submit" loading={busy} loadingText="Conectando…">Conectar</Button>
      {failure ? <StatusBanner tone="danger">{failure}</StatusBanner> : null}
    </form>
  );
}

function VerifyForm({ port, onDone }: { port: MessagingPort; onDone: Done }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const { formRef, errors, show } = useFormErrors<"code">();
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!show({ code: !/^[0-9]{6}$/.test(code.trim()) && "Informe os 6 números do código que chegou no número." })) return;
    setBusy(true);
    setFailure(null);
    try {
      await port.verify(code.trim(), newKey());
      setCode("");
      onDone("Número verificado. O canal está conectado.");
    } catch (err) {
      setFailure(explain(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form ref={formRef} className="tn-msg-form" aria-label="Verificar número" onSubmit={(e) => void submit(e)} noValidate>
      <Field label="Código recebido no número" inputMode="numeric" maxLength={6} value={code} error={errors.code} onChange={(e) => setCode(e.target.value)} />
      <Button type="submit" loading={busy} loadingText="Verificando…">Verificar</Button>
      {failure ? <StatusBanner tone="danger">{failure}</StatusBanner> : null}
    </form>
  );
}

/**
 * Campo de escrever, fixo no rodapé da conversa. O aviso de "na fila" fica dentro dele (no toast, cobriria o próprio
 * campo no celular).
 */
function SendForm({ port, convo, onSent }: { port: MessagingPort; convo: Conversation; onSent: () => void }) {
  const [text, setText] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const [key, setKey] = useState(newKey);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const { formRef, errors, show } = useFormErrors<"text">();
  // Fora da janela ou com pedido de SAIR, texto livre não é permitido (regra do canal, não validação).
  const blocked = !convo.contact.window_open || convo.contact.opted_out;
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!show({ text: !text.trim() && "Escreva a resposta antes de enviar." })) return;
    setBusy(true);
    setFailure(null);
    try {
      await port.send({ contact_id: convo.contact.id, kind: "text", text: text.trim() }, key);
      setKey(newKey());
      setText("");
      setSent("Mensagem na fila. Ela vira enviada, entregue ou lida conforme o provedor confirmar.");
      onSent();
    } catch (err) {
      setKey(newKey());
      setFailure(explain(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form ref={formRef} className="tn-msg-form tn-msg-composer" aria-label="Responder" onSubmit={(e) => void submit(e)} noValidate>
      <Field
        as="textarea"
        label="Resposta"
        hint={blocked ? (convo.contact.opted_out ? "A cliente pediu para não receber mensagens." : "Fora da janela de 24 h: só modelo aprovado.") : "Texto livre até 24 h após a última mensagem da cliente."}
        rows={2}
        maxLength={4096}
        value={text}
        error={errors.text}
        onChange={(e) => { setText(e.target.value); setSent(null); }}
        disabled={blocked}
      />
      <Button type="submit" loading={busy} loadingText="Enviando…" disabled={blocked}>Enviar</Button>
      {failure ? <StatusBanner tone="danger">{failure}</StatusBanner> : null}
      {sent ? <p role="status" className="tn-muted">{sent}</p> : null}
    </form>
  );
}

function TemplateForm({ port, convo, templates, onDone }: { port: MessagingPort; convo: Conversation; templates: ChannelStatus["templates"]; onDone: Done }) {
  const usable = templates.filter((t) => t.code !== "verificacao_numero");
  const [code, setCode] = useState(usable[0]?.code ?? "");
  const [params, setParams] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const t = usable.find((x) => x.code === code);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!t) return;
    setBusy(true);
    setFailure(null);
    try {
      await port.send({ contact_id: convo.contact.id, kind: "template", template_code: t.code, template_params: Array.from({ length: t.params }, (_, i) => params[i] ?? "") }, newKey());
      setParams([]);
      onDone("Modelo na fila. Ele vira enviado, entregue ou lido conforme o provedor confirmar.");
    } catch (err) {
      setFailure(explain(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="tn-msg-form" aria-label="Enviar modelo aprovado" onSubmit={(e) => void submit(e)} noValidate>
      <Field as="select" label="Modelo" value={code} onChange={(e) => { setCode(e.target.value); setParams([]); }}>
        {usable.map((x) => <option key={x.code} value={x.code} disabled={!x.approved}>{x.code}{x.approved ? "" : " (não aprovado)"}</option>)}
      </Field>
      {t ? <p className="tn-muted">{t.body}</p> : null}
      {t ? Array.from({ length: t.params }, (_, i) => (
        <Field key={i} label={`Campo ${i + 1}`} maxLength={300} value={params[i] ?? ""} onChange={(e) => setParams((p) => { const n = [...p]; n[i] = e.target.value; return n; })} />
      )) : null}
      {/* Modelo não aprovado ou cliente que pediu SAIR: o canal não permite (regra, não validação). */}
      <Button type="submit" variant="secondary" loading={busy} loadingText="Enviando…" disabled={!t?.approved || convo.contact.opted_out}>Enviar modelo</Button>
      {failure ? <StatusBanner tone="danger">{failure}</StatusBanner> : null}
    </form>
  );
}

/** Depois de uma ação: toast e recarga. */
function useActions(refresh: () => void) {
  const done: Done = (message) => {
    toast(message);
    refresh();
  };
  const fail = (e: unknown) => {
    toast({ tone: "danger", message: explain(e) });
    refresh();
  };
  /** Ação de um toque: sucesso no toast (com "Desfazer" quando houver volta); erro também no toast. */
  const act = (run: () => Promise<unknown>, ok: string, undo?: { run: () => Promise<unknown>; ok: string }) =>
    run().then(() => {
      refresh();
      toast({
        message: ok,
        action: undo ? { label: "Desfazer", onAction: () => undo.run().then(() => done(undo.ok), fail) } : undefined,
      });
    }, fail);
  return { done, fail, act };
}

function DemoNotice({ port }: { port: MessagingPort }) {
  return port.kind === "demo" ? (
    <StatusBanner tone="info"><strong>Demonstração.</strong> O provedor é simulado: nenhuma mensagem sai do navegador. O telefone da cliente é o simulador, no menu desta tela.</StatusBanner>
  ) : null;
}

/** Despacho da fila, só na demonstração (no servidor, o cron faz isso). */
function DispatchButton({ port, done, fail }: { port: MessagingPort; done: Done; fail: (e: unknown) => void }) {
  if (!port.dispatch) return null;
  return (
    <Button variant="secondary" onClick={() => void port.dispatch!().then((r) => done(`Despacho (simulação): ${r.sent} enviada(s), ${r.failed} falhou(aram), ${r.unknown} desconhecida(s), ${r.reconciled} resolvida(s).`), fail)}>
      Rodar o despacho (simulação)
    </Button>
  );
}

type Actions = ReturnType<typeof useActions>;

function ConnectionActions({ port, status, conn, actions }: {
  port: MessagingPort; status: ChannelStatus; conn: NonNullable<ChannelStatus["connection"]>; actions: Actions;
}) {
  return (
    <div className="tn-actions">
      {/* Desconectar não tem volta direta: para reconectar, o número passa de novo pela verificação. */}
      <ConfirmAction
        trigger="Desconectar"
        title="Desconectar o número?"
        consequence={
          <p>
            {conn.phone_e164} para de enviar e receber mensagens. O que está na fila ({status.queued}) não sai, e para
            voltar você conecta e verifica o número de novo com um código.
          </p>
        }
        confirmLabel="Sim, desconectar"
        onConfirm={() => actions.act(() => port.disconnect(newKey()), "Canal desconectado. O que estava na fila não sai.")}
      />
      <DispatchButton port={port} done={actions.done} fail={actions.fail} />
    </div>
  );
}

export function InboxPage({ port }: { port: MessagingPort; timezone?: string }) {
  const [status, setStatus] = useState<ChannelStatus | null>(null);
  const [inbox, setInbox] = useState<Inbox | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [nonce, setNonce] = useState(0);
  const [managing, setManaging] = useState(false);
  const panelId = useId();

  useEffect(() => {
    let alive = true;
    Promise.all([port.status(), port.inbox()]).then(([s, i]) => {
      if (!alive) return;
      setStatus(s);
      setInbox(i);
      setError(null);
    }, (e: unknown) => alive && setError(e ?? new Error("erro")));
    return () => { alive = false; };
  }, [port, nonce]);

  const actions = useActions(() => setNonce((x) => x + 1));
  const conn = status?.connection ?? null;
  const needsSetup = !!status && (!conn || conn.status === "disconnected");

  return (
    <div className="tn-stack">
      <div className="tn-page-intro">
        <PageHeader id="msg-title" title="Mensagens" />
        <Help><p>Canal oficial do seu número. Enviada, entregue, lida e falhou são estados diferentes; nada é reenviado sem você saber. Fora de 24 h da última mensagem da cliente, só modelos aprovados. Quem responde SAIR não recebe mais nada.</p></Help>
        <DemoNotice port={port} />
        {error ? <StatusBanner tone="danger">{explain(error)}</StatusBanner> : null}
      </div>
      {!status && !error ? <p role="status" className="tn-muted">Carregando…</p> : null}

      {/* Sem número: estado vazio guiado, com o que é e o passo para conectar. */}
      {needsSetup ? (
        <Card aria-labelledby="msg-setup-title">
          <div className="tn-stack" data-gap="sm">
            <h2 id="msg-setup-title">Conecte o número do seu negócio</h2>
            <p>Com o número conectado, as mensagens das suas clientes chegam aqui e você responde pelo canal oficial.</p>
            {conn?.status === "disconnected" ? <p className="tn-muted">O número {formatPhone(conn.phone_e164)} foi desconectado. Para voltar, conecte e verifique de novo.</p> : null}
            <ol className="tn-msg-steps">
              <li>Informe o número do negócio e toque em Conectar.</li>
              <li>Um código de 6 números chega pelo próprio canal, nesse número.</li>
              <li>Digite o código aqui para concluir.</li>
            </ol>
            <ConnectForm port={port} onDone={actions.done} />
          </div>
        </Card>
      ) : null}

      {/* Número registrado, falta o código: é o passo que importa agora. */}
      {status && conn?.status === "pending_verification" ? (
        <Card aria-labelledby="msg-verify-title">
          <div className="tn-msg-box" role="group" aria-label="Número conectado">
            <h2 id="msg-verify-title">Falta verificar o número</h2>
            <p><strong>{CONNECTION_STATUS[conn.status]}</strong> · {formatPhone(conn.phone_e164)} · {PROVIDER_LABEL[conn.provider]}</p>
            <VerifyForm port={port} onDone={actions.done} />
            <ConnectionActions port={port} status={status} conn={conn} actions={actions} />
          </div>
        </Card>
      ) : null}

      {/* Conectado: a conexão vira uma linha de status e as conversas vêm primeiro. */}
      {status && conn?.status === "active" ? (
        <div className="tn-msg-status" role="group" aria-label="Número conectado">
          <div className="tn-msg-status__line">
            <p>
              <strong>{conn.provider === "whatsapp_cloud" ? "WhatsApp conectado" : "Número simulado conectado"}</strong> · {formatPhone(conn.phone_e164)}
              {status.queued > 0 ? ` · ${status.queued} na fila` : ""}
              {status.unknown > 0 ? ` · ${status.unknown} com entrega desconhecida` : ""}
            </p>
            <Button variant="ghost" aria-expanded={managing} aria-controls={panelId} onClick={() => setManaging((v) => !v)}>
              Gerenciar
            </Button>
          </div>
          {managing ? (
            <div id={panelId} className="tn-msg-box">
              <p>{CONNECTION_STATUS[conn.status]} · {conn.phone_e164} · {PROVIDER_LABEL[conn.provider]}{conn.simulated ? " · simulação" : ""}</p>
              <p className="tn-muted">Na fila: {status.queued} · Entrega desconhecida: {status.unknown}</p>
              <ConnectionActions port={port} status={status} conn={conn} actions={actions} />
            </div>
          ) : null}
        </div>
      ) : null}

      {status && !needsSetup ? (
        <Card aria-labelledby="msg-inbox-title">
          <h2 id="msg-inbox-title">Caixa de entrada</h2>
          {inbox && inbox.contacts.length === 0 ? <p className="tn-muted">Nenhuma conversa ainda. Quando uma cliente escrever para o número, ela aparece aqui.</p> : null}
          <ul className="tn-msg-list">
            {inbox?.contacts.map((k) => (
              <li key={k.id}>
                {/* A linha inteira abre a conversa. */}
                <Link to={k.id} className="tn-msg-row">
                  <span className="tn-msg-row__head">
                    <strong>{k.customer_name ?? k.profile_name ?? k.phone_e164}</strong>
                    {k.unread_count > 0 ? <span className="tn-msg-badge">{unreadLabel(k.unread_count)}</span> : null}
                  </span>
                  {k.last_message ? (
                    <span className="tn-msg-row__last">
                      {k.last_message.direction === "inbound" ? "Cliente: " : "Você: "}{k.last_message.body} <span className="tn-muted">({MESSAGE_STATUS[k.last_message.status]})</span>
                    </span>
                  ) : null}
                  <span className="tn-muted">
                    {k.phone_e164} · {k.handling === "human" ? "Você está atendendo" : "Assistente atende"} · {k.opted_out ? "Pediu para não receber" : k.window_open ? "Janela aberta" : "Fora da janela de 24 h"}
                  </span>
                  <Icon name="seta" size={18} className="tn-msg-row__chevron" />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}

/** Tela da conversa: mensagens, ações do contato e o campo de escrever fixo no rodapé. */
export function ConversationPage({ port, timezone, contactId }: { port: MessagingPort; timezone: string; contactId: string }) {
  const [status, setStatus] = useState<ChannelStatus | null>(null);
  const [convo, setConvo] = useState<Conversation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    Promise.all([port.status(), port.conversation(contactId)]).then(([s, c]) => {
      if (!alive) return;
      setStatus(s);
      setConvo(c);
      setError(null);
    }, (e: unknown) => alive && setError(explain(e)));
    return () => { alive = false; };
  }, [port, contactId, nonce]);

  const refresh = () => setNonce((x) => x + 1);
  const actions = useActions(refresh);
  const { act } = actions;
  const conn = status?.connection ?? null;
  const back = (
    <Link to="/app/mensagens" className="tn-button tn-msg-back" data-variant="ghost">
      <Icon name="voltar" size={20} />
      Mensagens
    </Link>
  );

  if (!convo) {
    return (
      <div className="tn-stack">
        {back}
        <PageHeader id="msg-convo-title" title={error ? "Conversa não encontrada" : "Carregando…"} />
        {error ? <StatusBanner tone="danger">{error}</StatusBanner> : null}
      </div>
    );
  }

  const contact = convo.contact;
  const name = contact.customer_name ?? contact.profile_name ?? contact.phone_e164;
  return (
    <div className="tn-stack">
      {back}
      <div className="tn-page-intro">
        <PageHeader id="msg-convo-title" title={name} subtitle={contact.phone_e164 === name ? undefined : contact.phone_e164} />
        <DemoNotice port={port} />
        {error ? <StatusBanner tone="danger">{error}</StatusBanner> : null}
      </div>
      <section className="tn-stack" data-gap="sm" aria-label={`Conversa com ${name}`}>
        <p className="tn-muted">
          {contact.handling === "human" ? "Você está atendendo. " : "O assistente atende. "}
          {contact.window_open && contact.window_until ? `Texto livre até ${formatTime(contact.window_until, timezone)}.` : "Fora da janela de 24 h: só modelo aprovado."}
          {contact.opted_out ? " A cliente pediu para não receber mensagens." : ""}
        </p>
        <div className="tn-actions">
          <Button variant="secondary" onClick={() => void act(() => port.handoff(contact.id, contact.handling === "human" ? "assistant" : "human", newKey()), contact.handling === "human" ? "O assistente volta a atender." : "Você assumiu a conversa.")}>
            {contact.handling === "human" ? "Devolver ao assistente" : "Assumir a conversa"}
          </Button>
          {contact.opted_out ? (
            <Button variant="ghost" onClick={() => void act(() => port.consent(contact.id, true, newKey()), "Permissão registrada como declarada por você. Só use se a cliente pediu pessoalmente.")}>Cliente pediu para voltar a receber</Button>
          ) : null}
          {contact.customer_id ? (
            <Button
              variant="ghost"
              onClick={() => {
                // Desvincular volta atrás com o mesmo cadastro: executa na hora e o aviso oferece "Desfazer".
                const { id: cid, customer_id: customerId } = contact;
                void act(() => port.link(cid, null, newKey()), "Contato desvinculado do cadastro.", {
                  run: () => port.link(cid, customerId, newKey()),
                  ok: "Contato vinculado de novo ao cadastro.",
                });
              }}
            >
              Desvincular do cadastro
            </Button>
          ) : null}
          {conn?.status === "active" ? <DispatchButton port={port} done={actions.done} fail={actions.fail} /> : null}
        </div>
        {convo.messages.length === 0 ? <p className="tn-muted">Nenhuma mensagem nesta conversa.</p> : null}
        <ul className="tn-msg-thread" aria-label="Mensagens da conversa">
          {convo.messages.map((m) => (
            <li key={m.id} className="tn-msg-bubble" data-direction={m.direction}>
              <p>{m.body}</p>
              <p className="tn-muted">
                {m.direction === "inbound" ? "Cliente" : "Você"} · {formatTime(m.created_at, timezone)} · <strong>{MESSAGE_STATUS[m.status]}</strong>
                {m.status === "failed" && m.failure_reason ? ` (${FAILURE_REASON[m.failure_reason] ?? m.failure_reason})` : ""}
                {m.status === "delivery_unknown" ? " · o provedor não confirmou; consultamos o status, sem reenviar" : ""}
              </p>
            </li>
          ))}
        </ul>
        {conn?.status === "active" && status ? (
          <details className="tn-help">
            <summary>Enviar modelo aprovado</summary>
            <div className="tn-help__body">
              <TemplateForm port={port} convo={convo} templates={status.templates} onDone={actions.done} />
            </div>
          </details>
        ) : null}
        {conn?.status === "active" ? (
          <SendForm port={port} convo={convo} onSent={refresh} />
        ) : (
          <p className="tn-muted">Conecte e verifique o número em <Link to="/app/mensagens">Mensagens</Link> para responder.</p>
        )}
      </section>
    </div>
  );
}
