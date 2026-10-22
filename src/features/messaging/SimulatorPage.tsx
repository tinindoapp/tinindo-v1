// Simulador do telefone da cliente (P12). Só existe com a conexão simulada: mostra o que o provedor fictício
// "entregou" ao número e deixa a cliente escrever ou o provedor confirmar entrega/leitura, pelo MESMO webhook
// assinado que o provedor real usaria. Tudo rotulado como simulação.
import { type FormEvent, useEffect, useState } from "react";
import { Button, Card, StatusBanner } from "../../components/ui/index.tsx";
import { DEMO_CUSTOMERS } from "./demoPort.ts";
import { explain, formatTime } from "./labels.ts";
import { type MessagingPort, newKey, type SimPhone } from "./port.ts";

type Notice = { tone: "success" | "danger" | "info"; text: string } | null;

export function SimulatorPage({ port, timezone }: { port: MessagingPort; timezone: string }) {
  const [phone, setPhone] = useState(DEMO_CUSTOMERS[0]!.phone);
  const [shown, setShown] = useState<SimPhone | null>(null);
  const [text, setText] = useState("");
  const [notice, setNotice] = useState<Notice>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    port.simPhone(phone.trim()).then((p) => alive && setShown(p), (e: unknown) => { if (alive) { setShown(null); setNotice({ tone: "danger", text: explain(e) }); } });
    return () => { alive = false; };
  }, [port, phone, nonce]);
  const refresh = () => setNonce((x) => x + 1);

  async function write(e: FormEvent) {
    e.preventDefault();
    try {
      const r = await port.simInbound({ kind: "inbound", phone_e164: phone.trim(), text: text.trim() }, newKey());
      setText("");
      setNotice(r.applied ? { tone: "success", text: "Mensagem da cliente recebida pelo webhook." } : { tone: "info", text: "O webhook ignorou o evento (canal inativo ou duplicado)." });
      refresh();
    } catch (err) {
      setNotice({ tone: "danger", text: explain(err) });
    }
  }
  async function mark(providerMessageId: string, status: "delivered" | "read" | "failed") {
    try {
      const r = await port.simInbound({ kind: "status", provider_message_id: providerMessageId, status }, newKey());
      setNotice(r.applied ? { tone: "success", text: `Provedor confirmou: ${status === "delivered" ? "entregue" : status === "read" ? "lida" : "falhou"}.` } : { tone: "info", text: "Estado não avança para trás; nada mudou." });
    } catch (err) {
      setNotice({ tone: "danger", text: explain(err) });
    }
  }

  return (
    <div className="tn-msg">
      <Card aria-labelledby="sim-title">
        <h1 id="sim-title">Simulador do telefone</h1>
        <p className="tn-msg-muted">Simulação: o que o provedor fictício entregou a este número, e o que a cliente responde. Nada é enviado de verdade.</p>
        <StatusBanner tone="info"><strong>Simulação.</strong> Só existe com a conexão simulada. Na API oficial, estes eventos vêm do provedor.</StatusBanner>
        {notice ? <StatusBanner tone={notice.tone}>{notice.text}</StatusBanner> : null}
        <label className="tn-msg-field">Número da cliente (ou o do negócio, para ver o código)
          <input inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} list="sim-phones" />
        </label>
        <datalist id="sim-phones">{DEMO_CUSTOMERS.map((c) => <option key={c.id} value={c.phone}>{c.name}</option>)}</datalist>
        {port.dispatch ? <div className="tn-msg-actions"><Button variant="secondary" onClick={() => void port.dispatch!().then((r) => { setNotice({ tone: "info", text: `Despacho (simulação): ${r.sent} enviada(s), ${r.failed} falhou(aram), ${r.unknown} desconhecida(s), ${r.reconciled} resolvida(s).` }); refresh(); })}>Rodar o despacho (simulação)</Button></div> : null}
      </Card>
      <Card aria-labelledby="sim-phone-title">
        <h2 id="sim-phone-title">Recebidas neste número</h2>
        {shown && shown.messages.length === 0 ? <p className="tn-msg-muted">Nada entregue a este número ainda.</p> : null}
        <ul className="tn-msg-thread" aria-label="Mensagens entregues">
          {shown?.messages.map((m, i) => (
            <li key={`${m.provider_message_id ?? i}`} className="tn-msg-bubble">
              <p>{m.body}</p>
              <p className="tn-msg-muted">{formatTime(m.created_at, timezone)}</p>
              {m.provider_message_id ? (
                <div className="tn-msg-actions">
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
        <form className="tn-msg-form" aria-label="Cliente escreve" onSubmit={(e) => void write(e)}>
          <label className="tn-msg-field">Mensagem da cliente
            <input maxLength={4096} value={text} onChange={(e) => setText(e.target.value)} />
          </label>
          <Button type="submit" disabled={!text.trim()}>Enviar como cliente</Button>
        </form>
        <p className="tn-msg-muted">Responder SAIR ou PARAR registra o pedido para não receber mais mensagens.</p>
      </Card>
    </div>
  );
}
