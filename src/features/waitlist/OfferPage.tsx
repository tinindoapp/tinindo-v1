// Página pública da oferta de vaga (/oferta#t=…). O token sai da URL na hora e só vai ao servidor por POST.
// Abrir não reserva; aceitar e recusar são ações explícitas. Aceitar de novo mostra a mesma reserva.
import { useEffect, useState } from "react";
import type { WaitlistOfferView } from "@contracts";
import type { z } from "zod";
import { Button, Card, ConfirmAction, StatusBanner, Wordmark } from "../../components/ui/index.tsx";
import { formatCents, formatDateTime, formatSlot } from "./format.ts";
import type { OfferLinkPort } from "./port.ts";
import { errorExplainer } from "../../lib/errors.ts";
import { newIdempotencyKey } from "../../lib/idempotency.ts";
import { takeLinkToken } from "../../lib/public-link.ts";

const KEY = "tinindo.offer";

const explain = errorExplainer({ POLICY_REJECTED: "Esta oferta venceu ou não está mais disponível. Nenhuma reserva foi feita." });

type View = z.infer<typeof WaitlistOfferView>;

export function OfferPage({ port }: { port: OfferLinkPort }) {
  const [token] = useState(() => takeLinkToken(KEY));
  const [view, setView] = useState<View | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "accepted" | "declined" | "error">(token ? "loading" : "missing");
  const [message, setMessage] = useState<string | null>(null);
  const [keys] = useState(() => ({ accept: newIdempotencyKey(), decline: newIdempotencyKey() }));
  const [pending, setPending] = useState<"accept" | "decline" | null>(null);

  useEffect(() => {
    if (!token) return;
    let alive = true;
    port.view(token).then(
      (v) => { if (alive) { setView(v); setState(v.status === "accepted" ? "accepted" : v.status === "declined" ? "declined" : "ready"); } },
      () => alive && setState("missing"),
    );
    return () => { alive = false; };
  }, [port, token]);

  async function act(kind: "accept" | "decline") {
    if (!token) return;
    setPending(kind);
    setMessage(null);
    try {
      if (kind === "accept") {
        await port.accept(token, keys.accept);
        setState("accepted");
      } else {
        await port.decline(token, keys.decline);
        setState("declined");
      }
    } catch (err) {
      setMessage(explain(err));
    } finally {
      setPending(null);
    }
  }

  return (
    <main className="tn-auth">
      <Card aria-labelledby="offer-title">
        <Wordmark width={144} />
        <h1 id="offer-title" className="tn-auth__title">Vaga disponível</h1>
        {port.kind === "demo" ? <StatusBanner tone="info"><strong>Dados de exemplo.</strong> Demonstração sem servidor.</StatusBanner> : null}
        {state === "loading" ? <p role="status">Carregando…</p> : null}
        {state === "missing" ? <StatusBanner tone="warning">Este link não é válido ou já foi usado em outro aparelho.</StatusBanner> : null}
        {view && state !== "missing" ? (
          <dl className="tn-wl-offer">
            <dt>Onde</dt><dd>{view.business_name}</dd>
            <dt>Serviço</dt><dd>{view.service_name}</dd>
            <dt>Quando</dt><dd>{formatSlot(view.slot, view.timezone)}</dd>
            <dt>Valor</dt><dd className="tn-num">{formatCents(view.price_cents)}</dd>
          </dl>
        ) : null}
        {state === "ready" && view?.status === "offered" ? (
          <>
            <p className="tn-muted">Abrir esta página não reserva nada. A oferta vale até {formatDateTime(view.expires_at, view.timezone)}.</p>
            {message ? <StatusBanner tone="danger">{message}</StatusBanner> : null}
            <div className="tn-actions">
              <Button loading={pending === "accept"} disabled={pending !== null} onClick={() => void act("accept")}>Aceitar e reservar</Button>
              {/* Recusar libera a vaga para a próxima pessoa e não volta atrás: confirma antes. */}
              <ConfirmAction
                trigger="Não quero"
                triggerVariant="secondary"
                disabled={pending !== null}
                title="Recusar esta vaga?"
                consequence="A vaga vai para outra pessoa da lista e este link deixa de valer."
                confirmLabel="Sim, recusar"
                onConfirm={() => act("decline")}
              />
            </div>
          </>
        ) : null}
        {state === "ready" && view && view.status !== "offered" ? (
          <StatusBanner tone="warning">Esta oferta não está mais disponível ({view.status === "expired" ? "venceu" : "encerrada"}).</StatusBanner>
        ) : null}
        {state === "accepted" ? <StatusBanner tone="success">Reserva confirmada. Até lá!</StatusBanner> : null}
        {state === "declined" ? <StatusBanner tone="info">Tudo bem: a vaga foi liberada para outra pessoa.</StatusBanner> : null}
      </Card>
    </main>
  );
}
