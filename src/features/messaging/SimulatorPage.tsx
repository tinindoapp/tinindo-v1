// Simulador do telefone da cliente (P12). Só existe com a conexão simulada: mostra o que o provedor fictício
// "entregou" ao número e deixa a cliente escrever ou o provedor confirmar entrega/leitura, pelo MESMO webhook
// assinado que o provedor real usaria. Tudo rotulado como simulação.
import { type FormEvent, useEffect, useState } from "react";
import { Button, Card, Field, PageHeader, StatusBanner, toast, useFormErrors } from "../../components/ui/index.tsx";
import { DEMO_CUSTOMERS } from "./demoPort.ts";
import { explain, formatTime } from "./labels.ts";
import { type MessagingPort, newKey, type SimPhone } from "./port.ts";

export function SimulatorPage({ port, timezone }: { port: MessagingPort; timezone: string }) {
  const [phone, setPhone] = useState(DEMO_CUSTOMERS[0]!.phone);
  const [shown, setShown] = useState<SimPhone | null>(null);
  const [text, setText] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { formRef, errors, show } = useFormErrors<"text">();
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    port.simPhone(phone.trim()).then((p) => { if (alive) { setShown(p); setLoadError(null); } }, (e: unknown) => { if (alive) { setShown(null); setLoadError(explain(e)); } });
    return () => { alive = false; };
  }, [port, phone, nonce]);
  const refresh = () => setNonce((x) => x + 1);

  async function write(e: FormEvent) {
    e.preventDefault();
    if (!show({ text: !text.trim() && "Escreva a mensagem da cliente." })) return;
    setBusy(true);
    setWriteError(null);
    try {
      const r = await port.simInbound({ kind: "inbound", phone_e164: phone.trim(), text: text.trim() }, newKey());
      setText("");
      toast(r.applied ? "Mensagem da cliente recebida pelo webhook." : { tone: "info", message: "O webhook ignorou o evento (canal inativo ou duplicado)." });
      refresh();
    } catch (err) {
      setWriteError(explain(err));
    } finally {
      setBusy(false);
    }
  }
  async function mark(providerMessageId: string, status: "delivered" | "read" | "failed") {
    try {
      const r = await port.simInbound({ kind: "status", provider_message_id: providerMessageId, status }, newKey());
      toast(r.applied ? `Provedor confirmou: ${status === "delivered" ? "entregue" : status === "read" ? "lida" : "falhou"}.` : { tone: "info", message: "Estado não avança para trás; nada mudou." });
    } catch (err) {
      toast({ tone: "danger", message: explain(err) });
    }
  }

  return (
    <div className="tn-stack">
      <div className="tn-page-intro">
        <PageHeader id="sim-title" title="Simulador do telefone" />
        <p>Simulação: o que o provedor fictício entregou a este número, e o que a cliente responde. Nada é enviado de verdade.</p>
        <StatusBanner tone="info"><strong>Simulação.</strong> Só existe com a conexão simulada. Na API oficial, estes eventos vêm do provedor.</StatusBanner>
        {loadError ? <StatusBanner tone="danger">{loadError}</StatusBanner> : null}
        <Field label="Número da cliente (ou o do negócio, para ver o código)" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} list="sim-phones" />
        <datalist id="sim-phones">{DEMO_CUSTOMERS.map((c) => <option key={c.id} value={c.phone}>{c.name}</option>)}</datalist>
        {port.dispatch ? <div className="tn-actions"><Button variant="secondary" onClick={() => void port.dispatch!().then((r) => { toast({ tone: "info", message: `Despacho (simulação): ${r.sent} enviada(s), ${r.failed} falhou(aram), ${r.unknown} desconhecida(s), ${r.reconciled} resolvida(s).` }); refresh(); }, (e: unknown) => toast({ tone: "danger", message: explain(e) }))}>Rodar o despacho (simulação)</Button></div> : null}
      </div>
      <Card aria-labelledby="sim-phone-title">
        <h2 id="sim-phone-title">Recebidas neste número</h2>
        {shown && shown.messages.length === 0 ? <p className="tn-muted">Nada entregue a este número ainda.</p> : null}
        <ul className="tn-msg-thread" aria-label="Mensagens entregues">
          {shown?.messages.map((m, i) => (
            <li key={`${m.provider_message_id ?? i}`} className="tn-msg-bubble">
              <p>{m.body}</p>
              <p className="tn-muted">{formatTime(m.created_at, timezone)}</p>
              {m.provider_message_id ? (
                <div className="tn-actions">
                  <Button variant="ghost" onClick={() => void mark(m.provider_message_id!, "delivered")}>Marcar entregue</Button>
                  <Button variant="ghost" onClick={() => void mark(m.provider_message_id!, "read")}>Marcar lida</Button>
                  <Button variant="ghost" onClick={() => void mark(m.provider_message_id!, "failed")}>Marcar falhou</Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </Card>
      <Card aria-labelledby="sim-write-title">
        <h2 id="sim-write-title">A cliente escreve</h2>
        <form ref={formRef} className="tn-msg-form" aria-label="Cliente escreve" onSubmit={(e) => void write(e)} noValidate>
          <Field label="Mensagem da cliente" maxLength={4096} value={text} error={errors.text} onChange={(e) => setText(e.target.value)} />
          <Button type="submit" loading={busy} loadingText="Enviando…">Enviar como cliente</Button>
          {writeError ? <StatusBanner tone="danger">{writeError}</StatusBanner> : null}
        </form>
        <p className="tn-muted">Responder SAIR ou PARAR registra o pedido para não receber mais mensagens.</p>
      </Card>
    </div>
  );
}
