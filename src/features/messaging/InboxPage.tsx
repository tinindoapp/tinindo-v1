// Canal (P12): conexão do número e caixa de entrada (/app/mensagens), conversa (/app/mensagens/:id). O que a tela promete é o que o banco garante:
// enviado, entregue, lido, falhou e desconhecido são estados diferentes; nada é reenviado sozinho; fora da janela
// de 24 h só modelo aprovado; a cliente que pediu SAIR não recebe nada; humano assume quando você pede.
import { type FormEvent, type ReactNode, useEffect, useId, useState } from "react";
import { Link } from "react-router";
import { ActionBar, ActionRow, Button, CappedList, ConfirmAction, Field, FormPanel, ListCutNote, type MenuAction, PageHeader, Section, SetupHint, StatusBadge, StatusBanner, toast, useFormErrors } from "../../components/ui/index.tsx";
import { Icon } from "../../components/ui/icons.tsx";
import { CONNECTION_STATUS, explain, FAILURE_REASON, formatPhone, MESSAGE_STATUS, PROVIDER_LABEL, renderTemplate, RETRY_REASON, templateInfo, unreadLabel, VERIFICATION_STATUS } from "./labels.ts";
import { type ChannelProvider, type ChannelStatus, type Conversation, type Inbox, type MessagingPort } from "./port.ts";
import { useCommand, useIdempotencyKey } from "../../lib/idempotency.ts";
import { formatDateTime } from "../../lib/time.ts";
import { plural, pluralWord } from "../../lib/text/plural.ts";

/** Depois de uma ação: o aviso de sucesso sai no toast e a tela recarrega. Erro de formulário fica no formulário. */
type Done = (message: string) => void;
type ChannelActive = NonNullable<ChannelStatus["provider"]>;
/** Servidor antigo (sem `provider` no estado): o simulado, como antes. */
const SIMULATED_ACTIVE: ChannelActive = { active: "simulated", real: false, configured: true };

/** O que fazer na Meta antes de conectar o número oficial (release/WHATSAPP.md). */
export function MetaSteps() {
  return (
    <ol className="tn-msg-steps" aria-label="Antes, na Meta">
      <li>O número do negócio precisa estar cadastrado na conta do WhatsApp Business ligada à Tinindo (Cloud API). A equipe da Tinindo faz esse cadastro com você.</li>
      <li>No Gerenciador do WhatsApp da Meta, copie o “ID do número de telefone” (phone_number_id) desse número.</li>
      <li>Aqui: informe o número, o ID e o seu WhatsApp pessoal, e toque em Conectar. A Tinindo confere na Meta se o ID é desse número.</li>
      <li>Um código de 6 números chega no seu WhatsApp pessoal, enviado pelo número do negócio. Digite o código aqui para concluir.</li>
    </ol>
  );
}

/** O servidor decide o provedor pelo segredo MESSAGING_PROVIDER; a tela só mostra qual é. */
function ConnectForm({ port, active, onDone }: { port: MessagingPort; active: ChannelActive; onDone: Done }) {
  const provider: ChannelProvider = active.active;
  const real = provider === "whatsapp_cloud";
  const [phone, setPhone] = useState(real ? "" : "+5511999990001");
  const [accountId, setAccountId] = useState("");
  const [verifyTo, setVerifyTo] = useState("");
  const idem = useIdempotencyKey();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const { formRef, errors, show } = useFormErrors<"phone" | "account" | "verifyTo">();
  const e164 = /^\+[1-9]\d{7,14}$/;
  async function submit(e: FormEvent) {
    e.preventDefault();
    const value = phone.trim();
    const account = accountId.replace(/\s+/g, "");
    const to = verifyTo.trim();
    if (!show({
      phone: !value ? "Informe o número do negócio, ex.: +5511999990001." : !e164.test(value) && "Use o formato internacional: + código do país, DDD e número, ex.: +5511999990001.",
      account: real && (!account ? "Informe o ID do número na Meta (phone_number_id)." : !/^[0-9]{5,30}$/.test(account) && "O ID do número na Meta tem só números."),
      verifyTo: real && (!to ? "Informe o seu WhatsApp pessoal, que recebe o código." : !e164.test(to) ? "Use o formato internacional, ex.: +5511988887777." : to === value && "Use um WhatsApp diferente do número do negócio."),
    })) return;
    setBusy(true);
    setFailure(null);
    try {
      const meta = real ? { external_account_id: account, verify_to_e164: to } : undefined;
      await port.connect(provider, value, idem.keyFor({ provider, phone: value, ...meta }), meta);
      idem.reset();
      onDone(real
        ? "Número registrado. O código sai pelo número do negócio para o seu WhatsApp pessoal: confira e informe abaixo."
        : "Número registrado. O código de verificação sai pelo próprio canal: confira o telefone e informe abaixo.");
    } catch (err) {
      setFailure(explain(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form ref={formRef} className="tn-msg-form" aria-label="Conectar número" onSubmit={(e) => void submit(e)} noValidate>
      <p className="tn-muted">Provedor: {PROVIDER_LABEL[provider]}</p>
      {active.real && !active.configured ? (
        <StatusBanner tone="warning">O WhatsApp oficial ainda não está ligado neste ambiente. Fale com o suporte.</StatusBanner>
      ) : null}
      <Field label="Número do negócio (formato internacional)" inputMode="tel" autoComplete="off" value={phone} error={errors.phone} onChange={(e) => setPhone(e.target.value)} />
      {real ? (
        <>
          <Field label="ID do número na Meta (phone_number_id)" inputMode="numeric" autoComplete="off" hint="No Gerenciador do WhatsApp, em Configuração da API." value={accountId} error={errors.account} onChange={(e) => setAccountId(e.target.value)} />
          <Field label="Seu WhatsApp pessoal (recebe o código)" inputMode="tel" autoComplete="tel" hint="Diferente do número do negócio." value={verifyTo} error={errors.verifyTo} onChange={(e) => setVerifyTo(e.target.value)} />
        </>
      ) : null}
      <Button type="submit" loading={busy} loadingText="Conectando…" disabled={active.real && !active.configured}>Conectar</Button>
      {failure ? <StatusBanner tone="danger">{failure}</StatusBanner> : null}
    </form>
  );
}

/** Estado real do envio do código (banco): na fila, enviado, não saiu e por quê. */
function VerificationState({ status, timezone }: { status: ChannelStatus; timezone?: string }) {
  const v = status.verification;
  if (!v) return null;
  const to = formatPhone(v.send_to_e164);
  if (v.status === "failed") {
    return (
      <StatusBanner tone="danger">
        O código não saiu para {to}: {FAILURE_REASON[v.failure_reason ?? ""] ?? v.failure_reason ?? "o provedor recusou"}. Desconecte e conecte de novo depois de resolver.
      </StatusBanner>
    );
  }
  return (
    <p role="status" className="tn-muted">
      Código para {to}: {VERIFICATION_STATUS[v.status]}. Vale até {formatDateTime(v.expires_at, timezone ?? "America/Sao_Paulo")}.
    </p>
  );
}

function VerifyForm({ port, onDone }: { port: MessagingPort; onDone: Done }) {
  const [code, setCode] = useState("");
  const idem = useIdempotencyKey();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const { formRef, errors, show } = useFormErrors<"code">();
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!show({ code: !/^[0-9]{6}$/.test(code.trim()) && "Informe os 6 números do código que chegou no número." })) return;
    setBusy(true);
    setFailure(null);
    try {
      const value = code.trim();
      await port.verify(value, idem.keyFor({ verify: value }));
      idem.reset();
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
  const idem = useIdempotencyKey();
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
      const body = { contact_id: convo.contact.id, kind: "text" as const, text: text.trim() };
      await port.send(body, idem.keyFor(body));
      idem.reset();
      setText("");
      setSent("Mensagem na fila. Ela vira enviada, entregue ou lida conforme o provedor confirmar.");
      onSent();
    } catch (err) {
      setFailure(explain(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form ref={formRef} className="tn-msg-form tn-msg-composer" aria-label="Responder" onSubmit={(e) => void submit(e)} noValidate>
      <Field
        as="textarea"
        label="Sua resposta"
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

/** Primeiro nome de quem está na conversa, para já preencher "Nome da cliente" no modelo. */
function firstName(convo: Conversation): string {
  const name = convo.contact.customer_name ?? convo.contact.profile_name ?? "";
  return name.trim().split(/\s+/)[0] ?? "";
}

/**
 * Modelo aprovado (item 41): nome legível no lugar do código, cada campo com o nome do que vai nele (o nome da cliente
 * já vem preenchido), prévia do texto como a cliente vai receber e todos os campos vazios apontados de uma vez.
 */
function TemplateForm({ port, convo, templates, onDone, onCancel }: { port: MessagingPort; convo: Conversation; templates: ChannelStatus["templates"]; onDone: Done; onCancel: () => void }) {
  const usable = templates.filter((t) => t.code !== "verificacao_numero");
  const prefill = (code: string) => {
    const tpl = usable.find((x) => x.code === code);
    if (!tpl) return [];
    return templateInfo(tpl.code, tpl.params).fields.map((f) => (f === "Nome da cliente" ? firstName(convo) : ""));
  };
  const initial = (usable.find((t) => t.approved) ?? usable[0])?.code ?? "";
  const [code, setCode] = useState(initial);
  const [params, setParams] = useState<string[]>(() => prefill(initial));
  const idem = useIdempotencyKey();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const { formRef, errors, show } = useFormErrors();
  const t = usable.find((x) => x.code === code);
  const info = t ? templateInfo(t.code, t.params) : null;
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!t || !info) return;
    const values = Array.from({ length: t.params }, (_, i) => (params[i] ?? "").trim());
    if (!show(Object.fromEntries(values.map((v, i) => [`p${i}`, !v && `Preencha “${info.fields[i]}”.`])))) return;
    setBusy(true);
    setFailure(null);
    try {
      const body = { contact_id: convo.contact.id, kind: "template" as const, template_code: t.code, template_params: values };
      await port.send(body, idem.keyFor(body));
      idem.reset();
      onDone(`${info.name} na fila. Ele vira enviado, entregue ou lido conforme o provedor confirmar.`);
    } catch (err) {
      setFailure(explain(err));
    } finally {
      setBusy(false);
    }
  }
  if (usable.length === 0) return <p className="tn-muted">Nenhum modelo aprovado neste número ainda.</p>;
  return (
    <form ref={formRef} className="tn-stack" data-gap="sm" aria-label="Enviar modelo aprovado" onSubmit={(e) => void submit(e)} noValidate>
      <Field as="select" label="Modelo" value={code} onChange={(e) => { setCode(e.target.value); setParams(prefill(e.target.value)); show({}); }}>
        {usable.map((x) => (
          <option key={x.code} value={x.code} disabled={!x.approved}>
            {templateInfo(x.code, x.params).name}{x.approved ? "" : " (não aprovado)"}
          </option>
        ))}
      </Field>
      {t && info ? info.fields.map((field, i) => (
        <Field
          key={`${t.code}-${i}`}
          label={field}
          hint={info.examples?.[i] ? `Ex.: ${info.examples[i]}` : undefined}
          maxLength={300}
          value={params[i] ?? ""}
          error={errors[`p${i}`]}
          onChange={(e) => setParams((p) => { const n = [...p]; n[i] = e.target.value; return n; })}
        />
      )) : null}
      {t && info ? (
        <section className="tn-msg-preview" aria-label="Prévia da mensagem">
          <p className="tn-msg-preview__label">Prévia · como a cliente recebe</p>
          <p>{renderTemplate(t.body, params, info.fields)}</p>
        </section>
      ) : null}
      {failure ? <StatusBanner tone="danger">{failure}</StatusBanner> : null}
      <div className="tn-actions" data-sheet-footer>
        {/* Modelo não aprovado ou cliente que pediu SAIR: o canal não permite (regra, não validação). */}
        <Button type="submit" loading={busy} loadingText="Enviando…" disabled={!t?.approved || convo.contact.opted_out}>Enviar modelo</Button>
        <Button variant="ghost" onClick={onCancel}>Cancelar</Button>
      </div>
    </form>
  );
}

type Send = (key: string) => Promise<unknown>;

/** Depois de uma ação: toast e recarga. */
function useActions(refresh: () => void) {
  const command = useCommand();
  const done: Done = (message) => {
    toast(message);
    refresh();
  };
  const fail = (e: unknown) => {
    toast({ tone: "danger", message: explain(e) });
    refresh();
  };
  /** Ação de um toque: sucesso no toast (com "Desfazer" quando houver volta); erro também no toast. */
  const act = (intent: unknown, send: Send, ok: string, undo?: { intent: unknown; send: Send; ok: string }) =>
    command(intent, send).then(() => {
      refresh();
      toast({
        message: ok,
        action: undo ? { label: "Desfazer", onAction: () => command(undo.intent, undo.send).then(() => done(undo.ok), fail) } : undefined,
      });
    }, fail);
  return { done, fail, act };
}

/**
 * "Como funciona" de Mensagens. D11 b: sem aviso de demonstração por tela (a faixa do topo já diz); o que a
 * demonstração simula e o caminho para o simulador do telefone da cliente ficam aqui.
 */
function InboxHelp({ port }: { port: MessagingPort }) {
  return (
    <>
      <p>Canal oficial do seu número. Enviada, entregue, lida e falhou são estados diferentes; nada é reenviado sem você saber. Fora de 24 h da última mensagem da cliente, só modelos aprovados. Quem responde SAIR não recebe mais nada.</p>
      {port.kind === "demo" ? (
        <p>
          Na demonstração o provedor é simulado: nenhuma mensagem sai do navegador. Para escrever como cliente ou confirmar
          a entrega, use o <Link to="/app/mensagens/simulador">Simulador do telefone</Link>.
        </p>
      ) : null}
    </>
  );
}

const dispatchText = (r: { sent: number; failed: number; unknown: number; reconciled: number }) =>
  `Despacho (simulação): ${plural(r.sent, "enviada")}, ${r.failed} ${pluralWord(r.failed, "falhou", "falharam")}, ${plural(r.unknown, "desconhecida")}, ${plural(r.reconciled, "resolvida")}.`;

/** Despacho da fila, só na demonstração (no servidor, o cron faz isso). */
function DispatchButton({ port, done, fail }: { port: MessagingPort; done: Done; fail: (e: unknown) => void }) {
  if (!port.dispatch) return null;
  return (
    <Button variant="secondary" onClick={() => void port.dispatch!().then((r) => done(dispatchText(r)), fail)}>
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
        onConfirm={() => actions.act({ disconnect: conn.id, version: conn.version }, (key) => port.disconnect(key), "Canal desconectado. O que estava na fila não sai.")}
      />
      <DispatchButton port={port} done={actions.done} fail={actions.fail} />
    </div>
  );
}

/** `extra`: bloco do dono acima das conversas (P45: o resumo semanal da Tinindo). */
export function InboxPage({ port, timezone, extra }: { port: MessagingPort; timezone?: string; extra?: ReactNode }) {
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
    <div className="tn-stack tn-msg">
      <PageHeader id="msg-title" title="Mensagens" help={<InboxHelp port={port} />} />
      {error ? <StatusBanner tone="danger">{explain(error)}</StatusBanner> : null}
      {!status && !error ? <p role="status" className="tn-muted">Carregando…</p> : null}

      {/* Sem número: estado vazio guiado, com o que é e o passo para conectar. */}
      {needsSetup ? (
        <Section id="msg-setup-title" title="Conecte o número do seu negócio">
          <p>Com o número conectado, as mensagens das suas clientes chegam aqui e você responde pelo canal oficial.</p>
          {conn?.status === "disconnected" ? <p className="tn-muted">O número {formatPhone(conn.phone_e164)} foi desconectado. Para voltar, conecte e verifique de novo.</p> : null}
          {(status.provider ?? SIMULATED_ACTIVE).active === "whatsapp_cloud" ? <MetaSteps /> : (
            <ol className="tn-msg-steps">
              <li>Informe o número do negócio e toque em Conectar.</li>
              <li>Um código de 6 números chega pelo próprio canal, nesse número.</li>
              <li>Digite o código aqui para concluir.</li>
            </ol>
          )}
          <ConnectForm port={port} active={status.provider ?? SIMULATED_ACTIVE} onDone={actions.done} />
          <SetupHint to="/app/configurar" action="Ver os passos">
            Passo opcional de “Deixe seu negócio pronto”: sem provedor contratado, conecte o número simulado para testar o fluxo.
          </SetupHint>
        </Section>
      ) : null}

      {/* Número registrado, falta o código: é o passo que importa agora. */}
      {status && conn?.status === "pending_verification" ? (
        <Section id="msg-verify-title" title="Falta verificar o número">
          <div className="tn-msg-box" role="group" aria-label="Número conectado">
            <p><strong>{CONNECTION_STATUS[conn.status]}</strong> · {formatPhone(conn.phone_e164)} · {PROVIDER_LABEL[conn.provider]}</p>
            {conn.provider === "whatsapp_cloud" && conn.external_account_id ? <p className="tn-muted">ID do número na Meta: {conn.external_account_id}</p> : null}
            <VerificationState status={status} timezone={timezone} />
            <VerifyForm port={port} onDone={actions.done} />
            <ConnectionActions port={port} status={status} conn={conn} actions={actions} />
          </div>
        </Section>
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
            <Button variant="ghost" size="compact" aria-expanded={managing} aria-controls={panelId} onClick={() => setManaging((v) => !v)}>
              Gerenciar
            </Button>
          </div>
          {managing ? (
            <div id={panelId} className="tn-msg-box">
              <p>{CONNECTION_STATUS[conn.status]} · {conn.phone_e164} · {PROVIDER_LABEL[conn.provider]}{conn.simulated ? " · simulação" : ""}</p>
              {conn.provider === "whatsapp_cloud" && conn.external_account_id ? <p className="tn-muted">ID do número na Meta: {conn.external_account_id}</p> : null}
              <p className="tn-muted">Na fila: {status.queued} · Entrega desconhecida: {status.unknown}</p>
              <ConnectionActions port={port} status={status} conn={conn} actions={actions} />
            </div>
          ) : null}
        </div>
      ) : null}

      {status && !needsSetup ? (
        <Section id="msg-inbox-title" title="Caixa de entrada" count={inbox?.contacts.length || undefined}>
          {inbox && inbox.contacts.length === 0 ? <p className="tn-muted">Nenhuma conversa ainda. Quando uma cliente escrever para o número, ela aparece aqui.</p> : null}
          {inbox?.contacts.length ? (
            <CappedList
              items={inbox.contacts}
              label="Conversas"
              truncated={inbox.truncated?.contacts}
              truncatedText="Mostrando as 200 conversas mais recentes."
              render={(k) => (
                // A linha inteira abre a conversa.
                <ActionRow
                  key={k.id}
                  to={k.id}
                  title={k.customer_name ?? k.profile_name ?? k.phone_e164}
                  badge={k.unread_count > 0 ? <StatusBadge tone="info">{unreadLabel(k.unread_count)}</StatusBadge> : undefined}
                  meta={
                    <>
                      {k.last_message ? (
                        <span className="tn-msg-row__last">
                          {k.last_message.direction === "inbound" ? "Cliente: " : "Você: "}{k.last_message.body} ({MESSAGE_STATUS[k.last_message.status]})
                        </span>
                      ) : null}
                      <span>
                        {k.phone_e164} · {k.handling === "human" ? "Você está atendendo" : "Assistente atende"} · {k.opted_out ? "Pediu para não receber" : k.window_open ? "Janela aberta" : "Fora da janela de 24 h"}
                      </span>
                    </>
                  }
                />
              )}
            />
          ) : null}
        </Section>
      ) : null}

      {/* P45 e doc 07 §4.4: o resumo semanal fica em Mensagens, como seção compacta recolhida. Some quando não há resumo. */}
      {extra ? (
        <div className="tn-msg-digest">
          <Section id="msg-digest-section" title="Resumo da semana" collapsed>
            {extra}
          </Section>
        </div>
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
  const [templateOpen, setTemplateOpen] = useState(false);

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
  // Ações menos usadas da conversa: no "⋯" (P54, uma ação de cada peso à vista).
  const more: MenuAction[] = [];
  if (contact.opted_out) {
    more.push({ label: "Cliente pediu para voltar a receber", onSelect: () => void act({ consent: contact.id, optedIn: true }, (key) => port.consent(contact.id, true, key), "Permissão registrada como declarada por você. Só use se a cliente pediu pessoalmente.") });
  }
  if (contact.customer_id) {
    // Desvincular volta atrás com o mesmo cadastro: executa na hora e o aviso oferece "Desfazer".
    const { id: cid, customer_id: customerId } = contact;
    more.push({
      label: "Desvincular do cadastro",
      onSelect: () => void act({ link: cid, customer: null }, (key) => port.link(cid, null, key), "Contato desvinculado do cadastro.", {
        intent: { link: cid, customer: customerId },
        send: (key) => port.link(cid, customerId, key),
        ok: "Contato vinculado de novo ao cadastro.",
      }),
    });
  }
  if (conn?.status === "active" && port.dispatch) {
    const dispatch = port.dispatch;
    more.push({ label: "Rodar o despacho (simulação)", onSelect: () => void dispatch().then((r) => actions.done(dispatchText(r)), actions.fail) });
  }
  return (
    <div className="tn-stack">
      {back}
      <PageHeader id="msg-convo-title" title={name} subtitle={contact.phone_e164 === name ? undefined : contact.phone_e164} />
      {error ? <StatusBanner tone="danger">{error}</StatusBanner> : null}
      <section className="tn-stack" data-gap="sm" aria-label={`Conversa com ${name}`}>
        <p className="tn-muted">
          {contact.handling === "human" ? "Você está atendendo. " : "O assistente atende. "}
          {contact.window_open && contact.window_until ? `Texto livre até ${formatDateTime(contact.window_until, timezone)}.` : "Fora da janela de 24 h: só modelo aprovado."}
          {contact.opted_out ? " A cliente pediu para não receber mensagens." : ""}
        </p>
        <ActionBar more={more} moreLabel="Mais ações da conversa">
          <Button variant="secondary" onClick={() => void act({ handoff: contact.id, to: contact.handling === "human" ? "assistant" : "human" }, (key) => port.handoff(contact.id, contact.handling === "human" ? "assistant" : "human", key), contact.handling === "human" ? "O assistente volta a atender." : "Você assumiu a conversa.")}>
            {contact.handling === "human" ? "Devolver ao assistente" : "Assumir a conversa"}
          </Button>
          {conn?.status === "active" && status ? (
            <Button variant="ghost" aria-expanded={templateOpen} onClick={() => setTemplateOpen(true)}>Enviar modelo aprovado</Button>
          ) : null}
        </ActionBar>
        {convo.messages.length === 0 ? <p className="tn-muted">Nenhuma mensagem nesta conversa.</p> : null}
        <ul className="tn-msg-thread" aria-label="Mensagens da conversa">
          {convo.messages.map((m) => (
            <li key={m.id} className="tn-msg-bubble" data-direction={m.direction}>
              <p>{m.body}</p>
              <p className="tn-muted">
                {m.direction === "inbound" ? "Cliente" : "Você"} · {formatDateTime(m.created_at, timezone)} · <strong>{MESSAGE_STATUS[m.status]}</strong>
                {m.status === "failed" && m.failure_reason ? ` (${FAILURE_REASON[m.failure_reason] ?? m.failure_reason})` : ""}
                {m.status === "delivery_unknown" ? " · o provedor não confirmou; consultamos o status, sem reenviar" : ""}
                {m.status === "queued" && m.next_attempt_at
                  ? ` · nova tentativa a partir de ${formatDateTime(m.next_attempt_at, timezone)} (${RETRY_REASON[m.retry_reason ?? ""] ?? "limite de envio do WhatsApp"})`
                  : ""}
              </p>
            </li>
          ))}
        </ul>
        {convo.truncated?.messages ? <ListCutNote text="Mostrando as 200 mensagens mais recentes." /> : null}
        {/* Modelo aprovado: folha no celular; no desktop, cartão perto do campo de escrever, com o foco no primeiro campo. */}
        {conn?.status === "active" && status && templateOpen ? (
          <FormPanel title="Enviar modelo aprovado" onClose={() => setTemplateOpen(false)}>
            <TemplateForm
              port={port}
              convo={convo}
              templates={status.templates}
              onCancel={() => setTemplateOpen(false)}
              onDone={(m) => { setTemplateOpen(false); actions.done(m); }}
            />
          </FormPanel>
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
