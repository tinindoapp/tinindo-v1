// Página pública da cobrança (/pagar#t=…). O token sai da URL na hora e só vai ao servidor por POST.
// Mostra valor, Pix copia e cola e o estado real. Na cobrança simulada, um botão rotulado "paga" como a cliente.
import { useEffect, useState } from "react";
import { Button, Card, StatusBanner, Wordmark } from "../../components/ui/index.tsx";
import { CHARGE_STATUS, explain, formatCents } from "./labels.ts";
import { CodeDetails, CopyButton } from "./Share.tsx";
import type { LinkView, PaymentLinkPort } from "./port.ts";

const KEY = "tinindo.pay";

function takeToken(): string | null {
  const m = /(?:^#|&)t=([A-Za-z0-9_-]{43})(?:&|$)/.exec(window.location.hash);
  if (m?.[1]) {
    try {
      sessionStorage.setItem(KEY, m[1]);
    } catch {
      /* sem armazenamento: vale enquanto a página estiver aberta */
    }
    window.history.replaceState(window.history.state, "", window.location.pathname);
    return m[1];
  }
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** Não culpa a cliente: o link pode ter sido pago, cancelado ou vencido. */
export const missingText = (business?: string) =>
  `Não encontramos esta cobrança. Ela pode ter sido paga, cancelada ou ter vencido. Peça um novo link ${business ? `a ${business}` : "a quem te cobrou"}.`;

export function PayLinkPage({ port }: { port: PaymentLinkPort }) {
  const [token] = useState(takeToken);
  const [view, setView] = useState<LinkView | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing">(token ? "loading" : "missing");
  const [message, setMessage] = useState<{ tone: "success" | "danger" | "info"; text: string } | null>(null);
  const [lost, setLost] = useState(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!token) return;
    let alive = true;
    port.view(token).then((v) => { if (alive) { setView(v); setState("ready"); } }, () => alive && setState("missing"));
    return () => { alive = false; };
  }, [port, token, nonce]);

  async function pay(outcome: "paid" | "expired") {
    if (!token) return;
    try {
      const r = await port.simPay(token, outcome, !lost);
      setMessage(r.applied ? { tone: "success", text: outcome === "paid" ? "Pagamento simulado confirmado pelo banco." : "Cobrança vencida (simulação)." }
        : lost ? { tone: "info", text: "O banco registrou o pagamento, mas o aviso \"se perdeu\". O negócio verá a diferença ao conferir o dia, e a consulta ao banco resolve." }
        : { tone: "info", text: `Nada mudou: a cobrança está ${CHARGE_STATUS[r.status].toLowerCase()}.` });
      setNonce((x) => x + 1);
    } catch (err) {
      setMessage({ tone: "danger", text: explain(err) });
    }
  }

  return (
    <main className="tn-pay-public">
      <Wordmark />
      <Card aria-labelledby="paylink-title">
        <h1 id="paylink-title">{view ? `Pagar ${view.business_name}` : "Pagamento"}</h1>
        {state === "missing" ? <StatusBanner tone="warning">{missingText(port.businessName)}</StatusBanner> : null}
        {state === "loading" ? <p className="tn-pay-muted">Carregando…</p> : null}
        {view ? (
          <>
            <p>{view.description}</p>
            <p className="tn-pay-amount">{formatCents(view.amount_cents)}</p>
            <p><strong>{CHARGE_STATUS[view.status]}</strong></p>
            {view.simulated ? <StatusBanner tone="info"><strong>Simulação.</strong> Nenhum dinheiro é movimentado nesta cobrança.</StatusBanner> : null}
            {message ? <StatusBanner tone={message.tone}>{message.text}</StatusBanner> : null}
            {view.status === "pending" && view.pix_code ? (
              <div className="tn-pay-share">
                <div className="tn-pay-actions"><CopyButton text={view.pix_code} label="Copiar Pix" what="Pix" /></div>
                <p className="tn-pay-muted">Cole no app do seu banco, na opção Pix copia e cola.</p>
                <CodeDetails pix={view.pix_code} />
              </div>
            ) : null}
            {view.status === "pending" && view.checkout_url ? <p><a href={view.checkout_url}>Pagar no site do banco</a></p> : null}
            {view.status === "pending" && view.simulated ? (
              <div className="tn-pay-box" role="group" aria-label="Simular o pagamento">
                <label className="tn-pay-check"><input type="checkbox" checked={lost} onChange={(e) => setLost(e.target.checked)} /> Simular aviso do banco perdido</label>
                <div className="tn-pay-actions">
                  <Button onClick={() => void pay("paid")}>Pagar (simulação)</Button>
                  <Button variant="ghost" onClick={() => void pay("expired")}>Deixar expirar (simulação)</Button>
                </div>
              </div>
            ) : null}
          </>
        ) : null}
      </Card>
    </main>
  );
}
