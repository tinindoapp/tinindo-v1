// Canal (P12): conexão do número, caixa de entrada e conversa. O que a tela promete é o que o banco garante:
// enviado, entregue, lido, falhou e desconhecido são estados diferentes; nada é reenviado sozinho; fora da janela
// de 24 h só modelo aprovado; a cliente que pediu SAIR não recebe nada; humano assume quando você pede.
import { type FormEvent, useEffect, useState } from "react";
import { Button, Card, ConfirmAction, Field, Help, PageHeader, StatusBanner, toast, useFormErrors } from "../../components/ui/index.tsx";
import { CONNECTION_STATUS, explain, FAILURE_REASON, formatTime, MESSAGE_STATUS, PROVIDER_LABEL } from "./labels.ts";
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

function SendForm({ port, convo, onDone }: { port: MessagingPort; convo: Conversation; onDone: Done }) {
  const [text, setText] = useState("");
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
      onDone("Mensagem na fila. Ela vira enviada, entregue ou lida conforme o provedor confirmar.");
    } catch (err) {
      setKey(newKey());
      setFailure(explain(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form ref={formRef} className="tn-msg-form" aria-label="Responder" onSubmit={(e) => void submit(e)} noValidate>
      <Field
        as="textarea"
        label="Resposta (texto livre, só dentro de 24 h após a última mensagem da cliente)"
        rows={2}
        maxLength={4096}
        value={text}
        error={errors.text}
        onChange={(e) => setText(e.target.value)}
        disabled={blocked}
      />
      <Button type="submit" loading={busy} loadingText="Enviando…" disabled={blocked}>Enviar</Button>
      {failure ? <StatusBanner tone="danger">{failure}</StatusBanner> : null}
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

export function InboxPage({ port, timezone }: { port: MessagingPort; timezone: string }) {
  const [status, setStatus] = useState<ChannelStatus | null>(null);
  const [inbox, setInbox] = useState<Inbox | null>(null);
  const [convo, setConvo] = useState<Conversation | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [convoError, setConvoError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

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
  useEffect(() => {
    if (!selected) return;
    let alive = true;
    port.conversation(selected).then((c) => { if (alive) { setConvo(c); setConvoError(null); } }, (e: unknown) => alive && setConvoError(explain(e)));
    return () => { alive = false; };
  }, [port, selected, nonce]);

  const refresh = () => setNonce((x) => x + 1);
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
  const conn = status?.connection ?? null;

  return (
    <div className="tn-stack">
      <div className="tn-page-intro">
        <PageHeader id="msg-title" title="Mensagens" />
        <Help><p>Canal oficial do seu número. Enviada, entregue, lida e falhou são estados diferentes; nada é reenviado sem você saber. Fora de 24 h da última mensagem da cliente, só modelos aprovados. Quem responde SAIR não recebe mais nada.</p></Help>
        {port.kind === "demo" ? <StatusBanner tone="info"><strong>Demonstração.</strong> O provedor é simulado: nenhuma mensagem sai do navegador. O telefone da cliente é o simulador, no menu desta tela.</StatusBanner> : null}
        {error ? <StatusBanner tone="danger">{explain(error)}</StatusBanner> : null}
        {convoError ? <StatusBanner tone="danger">{convoError}</StatusBanner> : null}
      </div>

      <Card aria-labelledby="msg-conn-title">
        <h2 id="msg-conn-title">Conexão</h2>
        {status && !conn ? <ConnectForm port={port} onDone={done} /> : null}
        {conn ? (
          <div className="tn-msg-box" role="group" aria-label="Número conectado">
            <p><strong>{CONNECTION_STATUS[conn.status]}</strong> · {conn.phone_e164} · {PROVIDER_LABEL[conn.provider]}{conn.simulated ? " · simulação" : ""}</p>
            {conn.status === "pending_verification" ? <VerifyForm port={port} onDone={done} /> : null}
            {status ? <p className="tn-muted">Na fila: {status.queued} · Entrega desconhecida: {status.unknown}</p> : null}
            <div className="tn-actions">
              {/* Desconectar não tem volta direta: para reconectar, o número passa de novo pela verificação. */}
              <ConfirmAction
                trigger="Desconectar"
                title="Desconectar o número?"
                consequence={
                  <p>
                    {conn.phone_e164} para de enviar e receber mensagens. O que está na fila ({status?.queued ?? 0}) não sai, e para
                    voltar você conecta e verifica o número de novo com um código.
                  </p>
                }
                confirmLabel="Sim, desconectar"
                onConfirm={() => act(() => port.disconnect(newKey()), "Canal desconectado. O que estava na fila não sai.")}
              />
              {port.dispatch ? <Button variant="secondary" onClick={() => void port.dispatch!().then((r) => done(`Despacho (simulação): ${r.sent} enviada(s), ${r.failed} falhou(aram), ${r.unknown} desconhecida(s), ${r.reconciled} resolvida(s).`), fail)}>Rodar o despacho (simulação)</Button> : null}
            </div>
          </div>
        ) : null}
      </Card>

      <Card aria-labelledby="msg-inbox-title">
        <h2 id="msg-inbox-title">Caixa de entrada</h2>
        {inbox && inbox.contacts.length === 0 ? <p className="tn-muted">Nenhuma conversa ainda. Quando uma cliente escrever para o número, ela aparece aqui.</p> : null}
        <ul className="tn-msg-list">
          {inbox?.contacts.map((k) => (
            <li key={k.id} className="tn-msg-contact">
              <h3>{k.customer_name ?? k.profile_name ?? k.phone_e164}</h3>
              <p className="tn-muted">
                {k.phone_e164} · {k.handling === "human" ? "Você está atendendo" : "Assistente atende"} · {k.opted_out ? "Pediu para não receber" : k.window_open ? "Janela aberta" : "Fora da janela de 24 h"}
                {k.unread_count > 0 ? ` · ${k.unread_count} nova(s)` : ""}
              </p>
              {k.last_message ? <p>{k.last_message.direction === "inbound" ? "Cliente: " : "Você: "}{k.last_message.body} <span className="tn-muted">({MESSAGE_STATUS[k.last_message.status]})</span></p> : null}
              <div className="tn-actions">
                <Button variant="secondary" aria-pressed={selected === k.id} onClick={() => { setConvo(null); setSelected(k.id); }}>Abrir conversa</Button>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      {convo && status ? (
        <Card aria-labelledby="msg-convo-title">
          <h2 id="msg-convo-title">Conversa com {convo.contact.customer_name ?? convo.contact.profile_name ?? convo.contact.phone_e164}</h2>
          <p className="tn-muted">
            {convo.contact.window_open && convo.contact.window_until ? `Texto livre até ${formatTime(convo.contact.window_until, timezone)}.` : "Fora da janela de 24 h: só modelo aprovado."}
            {convo.contact.opted_out ? " A cliente pediu para não receber mensagens." : ""}
          </p>
          <div className="tn-actions">
            <Button variant="secondary" onClick={() => void act(() => port.handoff(convo.contact.id, convo.contact.handling === "human" ? "assistant" : "human", newKey()), convo.contact.handling === "human" ? "O assistente volta a atender." : "Você assumiu a conversa.")}>
              {convo.contact.handling === "human" ? "Devolver ao assistente" : "Assumir a conversa"}
            </Button>
            {convo.contact.opted_out ? (
              <Button variant="ghost" onClick={() => void act(() => port.consent(convo.contact.id, true, newKey()), "Permissão registrada como declarada por você. Só use se a cliente pediu pessoalmente.")}>Cliente pediu para voltar a receber</Button>
            ) : null}
            {convo.contact.customer_id ? (
              <Button
                variant="ghost"
                onClick={() => {
                  // Desvincular volta atrás com o mesmo cadastro: executa na hora e o aviso oferece "Desfazer".
                  const { id: contactId, customer_id: customerId } = convo.contact;
                  void act(() => port.link(contactId, null, newKey()), "Contato desvinculado do cadastro.", {
                    run: () => port.link(contactId, customerId, newKey()),
                    ok: "Contato vinculado de novo ao cadastro.",
                  });
                }}
              >
                Desvincular do cadastro
              </Button>
            ) : null}
          </div>
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
          {conn?.status === "active" ? <SendForm port={port} convo={convo} onDone={done} /> : <p className="tn-muted">Conecte e verifique o número para responder.</p>}
          {conn?.status === "active" ? <TemplateForm port={port} convo={convo} templates={status.templates} onDone={done} /> : null}
        </Card>
      ) : null}
    </div>
  );
}
