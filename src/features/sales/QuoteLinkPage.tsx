// Página pública do orçamento (/orcamento#t=… ou /orcamento/<endereço do negócio>#t=…). O token sai da URL na hora e
// só vai ao servidor por POST. O negócio vem primeiro (D18); a Tinindo só no rodapé.
// Abrir não aceita nada. Aceitar cita a versão e o código (hash) que a pessoa está vendo (o código não aparece na
// tela); se o profissional mudou o orçamento, a página mostra a versão nova antes. Aceitar não é pagar.
import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router";
import { Button, ConfirmAction, StatusBanner, whatsappHref } from "../../components/ui/index.tsx";
import { newIdempotencyKey } from "../../lib/idempotency.ts";
import { takeLinkToken } from "../../lib/public-link.ts";
import { type QuoteDecision, type QuoteLinkPort, type QuoteView } from "./port.ts";
import { type PublicBusiness, PublicDone, PublicFrame, PublicMissing, PublicSkeleton, usePublicBusiness } from "./public-kit.tsx";
import { formatCents, formatDay, formatSlotLong } from "./rules.ts";

const KEY = "tinindo.quote";
// Tira só o fragmento: o caminho (com o endereço do negócio, se houver) continua na barra.
const takeToken = () => takeLinkToken(KEY);

export const MISSING_TITLE = "Este orçamento não está mais disponível";

export function QuoteLinkPage({ port }: { port: QuoteLinkPort }) {
  const { slug } = useParams();
  const profile = usePublicBusiness(slug);
  const [token] = useState(takeToken);
  const [view, setView] = useState<QuoteView | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing">(token ? "loading" : "missing");
  const [result, setResult] = useState<QuoteDecision | null>(null);
  const [message, setMessage] = useState<{ tone: "danger" | "warning"; text: string } | null>(null);
  const [keys, setKeys] = useState(() => ({ accept: newIdempotencyKey(), decline: newIdempotencyKey() }));
  const [pending, setPending] = useState<"accept" | "decline" | null>(null);
  const acted = useRef(false);

  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!token) return;
    let alive = true;
    port.view(token).then(
      (v) => { if (alive) { setView(v); setState("ready"); } },
      () => alive && setState("missing"),
    );
    return () => { alive = false; };
  }, [port, token, nonce]);
  const reload = () => setNonce((n) => n + 1);

  // O nome do orçamento vale mais que o do perfil; foto, bairro, WhatsApp e endereço vêm do perfil publicado.
  const business: PublicBusiness | null | undefined = view ? { ...(profile ?? {}), name: view.business_name } : profile;
  const who = view?.business_name ?? "o profissional";

  async function act(kind: "accept" | "decline") {
    if (!token || !view) return;
    setPending(kind);
    setMessage(null);
    try {
      setResult(kind === "accept" ? await port.accept(token, view, keys.accept) : await port.decline(token, view, keys.decline));
      acted.current = true;
    } catch (err) {
      const code = (err as { code?: string } | null)?.code;
      if (code === "STALE_VERSION") {
        // Outra versão: mostrar a nova e exigir nova decisão (com chaves novas).
        setKeys({ accept: newIdempotencyKey(), decline: newIdempotencyKey() });
        reload();
        setMessage({ tone: "warning", text: `${who} atualizou este orçamento. Esta é a versão nova: confira antes de decidir. Nada foi aceito.` });
      } else if (code === "SLOT_CONFLICT") {
        setMessage({ tone: "danger", text: `O horário proposto não está mais livre. Nada foi aceito. Fale com ${who} para combinar outro.` });
      } else if (code === "POLICY_REJECTED") {
        reload();
        setMessage({ tone: "danger", text: "Este orçamento venceu ou já foi decidido. Nada foi alterado." });
      } else {
        setMessage({ tone: "danger", text: "Não foi possível concluir agora. Tentar de novo é seguro." });
      }
    } finally {
      setPending(null);
    }
  }

  const decided = result?.status ?? (view && (view.status === "accepted" || view.status === "declined") ? view.status : null);
  // Depois de decidir, o foco vai para o título da tela final.
  useEffect(() => {
    if (decided && acted.current) document.getElementById("ql-done-title")?.focus();
  }, [decided]);

  const whatsapp = (label: string, text: string, variant: "primary" | "secondary" = "secondary") =>
    business?.whatsapp_e164 ? (
      <a className="tn-button" data-variant={variant} href={whatsappHref(business.whatsapp_e164, text)} target="_blank" rel="noopener noreferrer">{label}</a>
    ) : null;

  function body() {
    if (state === "loading") {
      return (
        <>
          <h1>Orçamento</h1>
          <PublicSkeleton label="Carregando o orçamento…" />
        </>
      );
    }
    if (!view || state === "missing") {
      return (
        <PublicMissing title={MISSING_TITLE} business={business} what="o orçamento">
          <p>Este link não é válido, foi substituído por outro ou o orçamento foi cancelado.</p>
        </PublicMissing>
      );
    }
    const slot = view.slot ? `${formatSlotLong(view.slot, view.timezone)}${view.slot_service_name ? ` (${view.slot_service_name})` : ""}` : null;
    const demo = port.kind === "demo" ? <StatusBanner tone="info"><strong>Dados de exemplo.</strong> Demonstração sem servidor.</StatusBanner> : null;
    if (decided === "accepted") {
      const booked = result?.booking ? formatSlotLong(result.booking, view.timezone) + (view.slot_service_name ? ` (${view.slot_service_name})` : "") : slot;
      return (
        <PublicDone title="Orçamento aceito" titleId="ql-done-title">
          <dl className="tn-pub-facts tn-qt-facts">
            <div><dt>Orçamento</dt><dd>{view.title}</dd></div>
            <div><dt>Total</dt><dd className="tn-num">{formatCents(view.total_cents)}</dd></div>
            {booked ? <div><dt>Horário reservado</dt><dd>{booked}</dd></div> : null}
          </dl>
          <p>O pagamento é combinado com {view.business_name}.</p>
          {demo}
        </PublicDone>
      );
    }
    if (decided === "declined") {
      const talk = whatsapp(`Falar com ${view.business_name} no WhatsApp`, `Olá! Recusei o orçamento "${view.title}", mas queria conversar sobre ele.`);
      return (
        <section className="tn-qt-pub" aria-labelledby="ql-done-title">
          <h1 id="ql-done-title" tabIndex={-1}>Orçamento recusado</h1>
          <p>{view.business_name} verá a sua resposta. Nada foi reservado nem cobrado.</p>
          <p className="tn-muted">Se mudou de ideia, peça um novo orçamento a {view.business_name}.</p>
          {talk ? <div className="tn-pub-cta" data-inline>{talk}</div> : null}
          {demo}
        </section>
      );
    }
    const open = view.status === "sent";
    const again = whatsapp(`Pedir novo orçamento a ${view.business_name}`, `Olá! O orçamento "${view.title}" venceu. Pode me mandar de novo?`, "primary");
    return (
      <section className="tn-qt-pub" aria-labelledby="ql-title">
        <h1 id="ql-title">Orçamento: {view.title}</h1>
        <p><strong className="tn-qt-tag">{view.status === "expired" ? "Venceu em" : "Válido até"} <span className="tn-num">{formatDay(view.valid_until, view.timezone)}</span></strong></p>
        {demo}
        <ul className="tn-qt-lines" aria-label="Itens do orçamento">
          {view.items.map((i, n) => (
            <li key={n}>
              <span>
                {i.description}
                {i.quantity > 1 ? <small className="tn-num">{i.quantity} × {formatCents(i.unit_price_cents)}</small> : null}
              </span>
              <span className="tn-num">{formatCents(i.line_total_cents)}</span>
            </li>
          ))}
        </ul>
        <p className="tn-qt-totalband"><span>Total</span> <strong className="tn-num">{formatCents(view.total_cents)}</strong></p>
        {slot ? <p className="tn-qt-slot"><span>Ao aceitar, você reserva:</span> <strong>{slot}</strong></p> : null}
        {view.notes ? <p>Observações de {view.business_name}: {view.notes}</p> : null}
        {message ? <StatusBanner tone={message.tone}>{message.text}</StatusBanner> : null}
        {open ? (
          <>
            <p className="tn-muted">Abrir esta página não aceita nada. Aceitar não é pagar: o pagamento é combinado com {view.business_name}.</p>
            <div className="tn-pub-cta">
              <Button loading={pending === "accept"} loadingText="Aceitando…" disabled={pending === "decline"} onClick={() => void act("accept")}>Aceitar orçamento</Button>
              {whatsapp("Pedir ajuste pelo WhatsApp", `Olá! Vi o orçamento "${view.title}" e queria pedir um ajuste antes de aceitar.`)}
              {/* Recusar é definitivo (05 #10): ação discreta, com confirmação. */}
              <ConfirmAction
                trigger="Recusar"
                triggerVariant="ghost"
                title="Recusar este orçamento?"
                consequence={<p>{view.business_name} verá a recusa. Para mudar algo, fale com ele antes.</p>}
                confirmLabel="Sim, recusar"
                disabled={pending === "accept"}
                onConfirm={() => act("decline")}
              />
            </div>
          </>
        ) : null}
        {view.status === "expired" ? (
          <>
            <StatusBanner tone="warning">Este orçamento venceu. Peça uma nova versão a {view.business_name}.</StatusBanner>
            {again ? <div className="tn-pub-cta">{again}</div> : null}
          </>
        ) : null}
      </section>
    );
  }

  return <PublicFrame business={business} footNote={view && state !== "missing" ? `Versão ${view.version_no}` : undefined}>{body()}</PublicFrame>;
}
