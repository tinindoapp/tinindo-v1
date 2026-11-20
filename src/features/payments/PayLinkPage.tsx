// Página pública da cobrança (/pagar#t=… ou /pagar/<endereço do negócio>#t=…). O token sai da URL na hora e só vai
// ao servidor por POST. O negócio vem primeiro (D18); a Tinindo só no rodapé. Mostra quem recebe, o valor, o prazo e o
// Pix copia e cola. D22: a simulação de pagamento só aparece na demonstração offline; com servidor, cobrança simulada
// vira um aviso de teste, sem código Pix e sem botão de pagar.
import { takeLinkToken } from "../../lib/public-link.ts";
import { now } from "../../lib/time.ts";
import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router";
import { Button, StatusBanner, toast } from "../../components/ui/index.tsx";
import { CHARGE_STATUS, deadlineText, explain, formatCents, formatPaidAt, missingText, splitDescription } from "./labels.ts";
import { CodeDetails, CopyButton } from "./Share.tsx";
import type { LinkView, PaymentLinkPort } from "./port.ts";
import { type PublicBusiness, PublicDone, PublicFrame, PublicMissing, PublicSkeleton, usePublicBusiness } from "../../components/public/public-kit.tsx";

const KEY = "tinindo.pay";

const takeToken = () => takeLinkToken(KEY);

export const MISSING_TITLE = "Este link de pagamento não vale mais";
/** Estados em que o link não serve mais para pagar. */
const DEAD = new Set<LinkView["status"]>(["expired", "cancelled", "failed"]);

export function PayLinkPage({ port }: { port: PaymentLinkPort }) {
  const { slug } = useParams();
  const profile = usePublicBusiness(slug);
  const [token] = useState(takeToken);
  const [view, setView] = useState<LinkView | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing">(token ? "loading" : "missing");
  // Só o que precisa ser lido com calma fica na tela; a confirmação do pagamento sai num aviso curto.
  const [message, setMessage] = useState<{ tone: "danger" | "info"; text: string } | null>(null);
  const [busy, setBusy] = useState<"paid" | "expired" | null>(null);
  const [lost, setLost] = useState(false);
  const [copied, setCopied] = useState(false);
  const [nonce, setNonce] = useState(0);
  const acted = useRef(false);

  useEffect(() => {
    if (!token) return;
    let alive = true;
    port.view(token).then((v) => { if (alive) { setView(v); setState("ready"); } }, () => alive && setState("missing"));
    return () => { alive = false; };
  }, [port, token, nonce]);

  // Depois de pagar (na demonstração), o foco vai para o título da tela de confirmação.
  const paid = view?.status === "paid";
  useEffect(() => {
    if (paid && acted.current) document.getElementById("pay-done-title")?.focus();
  }, [paid]);

  async function pay(outcome: "paid" | "expired") {
    if (!token) return;
    setBusy(outcome);
    try {
      const r = await port.simPay(token, outcome, !lost);
      if (r.applied) {
        acted.current = true;
        setMessage(null);
        toast(outcome === "paid" ? "Pagamento simulado confirmado pelo banco." : "Cobrança vencida (simulação).");
      } else {
        setMessage(lost ? { tone: "info", text: "O banco registrou o pagamento, mas o aviso \"se perdeu\". O negócio verá a diferença ao conferir o dia, e a consulta ao banco resolve." }
          : { tone: "info", text: `Nada mudou: a cobrança está ${CHARGE_STATUS[r.status].toLowerCase()}.` });
      }
      setNonce((x) => x + 1);
    } catch (err) {
      setMessage({ tone: "danger", text: explain(err) });
    } finally {
      setBusy(null);
    }
  }

  // O nome da cobrança vale mais que o do perfil; foto, bairro, WhatsApp e endereço vêm do perfil publicado.
  const business: PublicBusiness | null | undefined = view
    ? { ...(profile ?? {}), name: view.business_name }
    : profile ?? (port.businessName ? { name: port.businessName } : null);
  const name = business?.name ?? null;
  const demo = port.kind === "demo";

  function body() {
    if (state === "loading") {
      return (
        <>
          <h1>Pagamento</h1>
          <PublicSkeleton label="Carregando a cobrança…" />
        </>
      );
    }
    if (!view || DEAD.has(view.status)) {
      return (
        <PublicMissing title={MISSING_TITLE} business={business} what="o link de pagamento">
          <p>{missingText(name)}</p>
        </PublicMissing>
      );
    }
    // 05 #19: só o serviço; o nome de quem deve não aparece para quem recebeu o link encaminhado.
    const service = splitDescription(view.description).service;
    const amount = <p className="tn-pay-amount tn-num">{formatCents(view.amount_cents)}</p>;
    if (view.simulated && !demo) {
      // D22: fora da demonstração, cobrança simulada não mostra Pix nem botão de pagar.
      return (
        <section className="tn-pay-pub" aria-labelledby="paylink-title">
          <h1 id="paylink-title">Cobrança de {service}</h1>
          {amount}
          <StatusBanner tone="warning">Esta cobrança é um teste e não pode ser paga. Peça a {view.business_name} um link de pagamento de verdade.</StatusBanner>
        </section>
      );
    }
    if (view.status === "paid") {
      return (
        <PublicDone title="Pagamento confirmado" titleId="pay-done-title">
          {amount}
          <dl className="tn-pub-facts tn-pay-facts">
            <div><dt>Referente a</dt><dd>{service}</dd></div>
            <div><dt>Quem recebeu</dt><dd>{view.business_name}</dd></div>
            {view.paid_at ? <div><dt>Pago em</dt><dd className="tn-num">{formatPaidAt(view.paid_at)}</dd></div> : null}
          </dl>
          <p>Não precisa mandar comprovante.</p>
          {demo ? <StatusBanner tone="info"><strong>Simulação.</strong> Nenhum dinheiro é movimentado nesta cobrança.</StatusBanner> : null}
        </PublicDone>
      );
    }
    const pending = view.status === "pending";
    return (
      <section className="tn-pay-pub" aria-labelledby="paylink-title">
        <h1 id="paylink-title">Cobrança de {service}</h1>
        {amount}
        <p className="tn-pay-meta">
          <strong className="tn-pay-tag">{CHARGE_STATUS[view.status]}</strong>
          {pending && view.expires_at ? <span className="tn-num">{deadlineText(view.expires_at, port.now?.() ?? now())}</span> : null}
        </p>
        <dl className="tn-pub-facts tn-pay-facts">
          <div><dt>Quem recebe</dt><dd>{view.business_name}</dd></div>
        </dl>
        {demo ? <StatusBanner tone="info"><strong>Simulação.</strong> Nenhum dinheiro é movimentado nesta cobrança.</StatusBanner> : null}
        {message ? <StatusBanner tone={message.tone}>{message.text}</StatusBanner> : null}
        {pending && view.pix_code ? (
          <div className="tn-pay-share tn-pay-copy">
            <CopyButton text={view.pix_code} label="Copiar código Pix" what="Código Pix" onCopied={() => setCopied(true)} />
            {copied ? <p role="status">Abra o app do seu banco e escolha Pix copia e cola.</p> : null}
            <p className="tn-pay-safety">No app do banco, confira se quem recebe é {view.business_name}. Se for outro nome, não pague e fale com {view.business_name}.</p>
            <CodeDetails pix={view.pix_code} />
          </div>
        ) : null}
        {pending && view.checkout_url ? <p><a href={view.checkout_url}>Pagar no site do banco</a></p> : null}
        {pending && demo ? (
          <div className="tn-pay-box" role="group" aria-label="Simular o pagamento">
            <label className="tn-pay-check"><input type="checkbox" checked={lost} onChange={(e) => setLost(e.target.checked)} /> Simular aviso do banco perdido</label>
            <div className="tn-actions">
              <Button loading={busy === "paid"} disabled={!!busy} onClick={() => void pay("paid")}>Pagar (simulação)</Button>
              <Button variant="ghost" loading={busy === "expired"} disabled={!!busy} onClick={() => void pay("expired")}>Deixar expirar (simulação)</Button>
            </div>
          </div>
        ) : null}
      </section>
    );
  }

  return <PublicFrame business={business}>{body()}</PublicFrame>;
}
